// The panel editor. It owns the panel being edited and talks to the main process only through
// window.libreshardEditor (editor-preload.js): the main process validates and installs on "Save".
// The canvas is an iframe (panel-preview.html) drawn by the tablet's own code; it reports clicks and
// drags, and this page changes the panel and sends it back. Texts are always set as text.
const api = window.libreshardEditor;
const K = window.Keycodes;

const SIZES = { landscape: [1280, 800], portrait: [800, 1280], phone: [390, 844] };
const TYPES = ['press', 'hold', 'repeat', 'toggle', 'page', 'label'];
const KEYED = ['press', 'hold', 'repeat'];

let init = null; // what the main process sent: strings, platform, icons, limits
const S = {
  id: null, meta: { name: '', icon: '' }, panel: null, images: {},
  page: 0, sel: null, size: 'landscape',
  undo: [], redo: [], saved: '', coalesce: null,
  small: [], check: null, loadWarnings: [],
  capture: null, // { done(combo) } while capturing a key
};

const $ = (id) => document.getElementById(id);

function t(key, vars = {}) {
  const s = (init && init.strings[key]) || key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// h('div', { class: 'x', onclick: fn }, 'text', child…). Strings become text nodes.
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value' || k === 'checked' || k === 'selected') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  return fill(el, ...children);
}
function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity)
    .filter((c) => c !== null && c !== undefined && c !== false)
    .map((c) => (c instanceof Node ? c : String(c))));
  return el;
}

let toastTimer;
function toast(text, error = false) {
  const el = $('toast');
  el.textContent = text;
  el.className = 'toast' + (error ? ' error' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, error ? 8000 : 3500);
}

/* ---------- The panel ---------- */

const page = () => S.panel.pages[S.page];
const selected = () => (S.sel ? page().buttons.find((b) => b.id === S.sel) || null : null);
const allButtons = () => S.panel.pages.flatMap((p) => p.buttons);
const graphemes = (s, n) => [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].slice(0, n).map((x) => x.segment).join('');

function freshId(prefix, used) {
  let n = 1;
  while (used.has(prefix + n)) n++;
  return prefix + n;
}
const newButtonId = () => freshId('b', new Set(allButtons().map((b) => b.id)));
const newPageId = () => freshId('p', new Set(S.panel.pages.map((p) => p.id)));

// Whether a rectangle is inside the grid and free on the current page (ignoring button `id`)
function fits(col, row, w, h, id, p = page()) {
  const { cols, rows } = S.panel.grid;
  if (col < 0 || row < 0 || col + w > cols || row + h > rows) return false;
  return !p.buttons.some((b) => b.id !== id && col < b.col + b.w && b.col < col + w && row < b.row + b.h && b.row < row + h);
}

// A button that can't do anything yet: saving is refused until it can
const incomplete = (b) => (KEYED.includes(b.type) && !b.key) ||
  (b.type === 'toggle' && (!b.keys || !b.keys[0] || !b.keys[1])) ||
  (b.type === 'page' && !b.page);

function keysInUse() {
  const keys = new Set();
  for (const b of allButtons()) {
    if (KEYED.includes(b.type) && b.key) keys.add(b.key);
    if (b.type === 'toggle') (b.keys || []).filter(Boolean).forEach((k) => keys.add(k));
  }
  return [...keys];
}

/* ---------- Changes, undo and redo ---------- */

const snapshot = () => JSON.stringify({ panel: S.panel, meta: S.meta });

// Applies fn to the panel as one undo step. Edits with the same `coalesce` key in a row (typing in
// one field) make a single step.
function change(fn, { coalesce = null, props = true, pages = true } = {}) {
  const before = snapshot();
  fn();
  if (snapshot() === before) return;
  if (!coalesce || coalesce !== S.coalesce) {
    S.undo.push(before);
    if (S.undo.length > 200) S.undo.shift();
  }
  S.coalesce = coalesce;
  S.redo = [];
  render({ props, pages });
}

function restore(snap) {
  const s = JSON.parse(snap);
  S.panel = s.panel;
  S.meta = s.meta;
  S.page = Math.min(S.page, S.panel.pages.length - 1);
  if (!selected()) S.sel = null;
  S.coalesce = null;
  render();
}
function undo() { if (S.undo.length) { S.redo.push(snapshot()); restore(S.undo.pop()); } }
function redo() { if (S.redo.length) { S.undo.push(snapshot()); restore(S.redo.pop()); } }

/* ---------- Rendering ---------- */

function render({ props = true, pages = true } = {}) {
  const dirty = snapshot() !== S.saved;
  api.setDirty(dirty);
  document.title = `${S.meta.name || t('editor.untitled')}${dirty ? ' •' : ''} · ${t('editor.windowTitle')}`;
  if (document.activeElement !== $('name')) $('name').value = S.meta.name;
  if (document.activeElement !== $('icon')) $('icon').value = S.meta.icon;
  $('cols').value = S.panel.grid.cols;
  $('rows').value = S.panel.grid.rows;
  $('pageBar').checked = S.panel.pageBar !== false;
  $('undo').disabled = !S.undo.length;
  $('redo').disabled = !S.redo.length;
  if (pages) renderPages();
  if (props) renderProps();
  sendPreview();
  scheduleCheck();
  renderWarnings();
}

function sendPreview() {
  const frame = $('preview');
  if (!frame.contentWindow || !S.previewReady || !S.panel) return;
  frame.contentWindow.postMessage({
    t: 'render', panel: S.panel, name: S.meta.name, images: S.images, page: page().id, selected: S.sel,
  }, '*');
}

// The iframe is drawn at the device's size and scaled down to fit the stage
function layoutPreview() {
  const [w, h] = SIZES[S.size];
  const stage = $('stage');
  const scale = Math.min((stage.clientWidth - 24) / w, (stage.clientHeight - 24) / h, 1);
  const frame = $('preview');
  frame.style.width = w + 'px';
  frame.style.height = h + 'px';
  frame.style.transform = `scale(${scale})`;
  $('frameBox').style.width = Math.round(w * scale) + 'px';
  $('frameBox').style.height = Math.round(h * scale) + 'px';
}

function renderPages() {
  const pages = S.panel.pages;
  fill($('pages'), pages.map((p, i) => h('div', { class: 'ed-page' + (i === S.page ? ' on' : '') },
    h('input', {
      value: p.name, maxlength: '60', 'aria-label': t('editor.pageNameLabel'),
      onfocus: () => selectPage(i),
      oninput: (e) => change(() => { p.name = e.target.value; }, { coalesce: 'page-name:' + p.id, props: false, pages: false }),
      onchange: (e) => change(() => { p.name = e.target.value.trim() || t('editor.pageName', { n: i + 1 }); }),
    }),
    h('span', { class: 'ed-count' }, String(p.buttons.length)),
    h('button', { class: 'icon-btn', title: t('editor.pageUp'), 'aria-label': t('editor.pageUp'), disabled: i === 0, onclick: () => movePage(i, -1) }, '↑'),
    h('button', { class: 'icon-btn', title: t('editor.pageDown'), 'aria-label': t('editor.pageDown'), disabled: i === pages.length - 1, onclick: () => movePage(i, 1) }, '↓'),
    h('button', { class: 'icon-btn', title: t('editor.pageDelete'), 'aria-label': t('editor.pageDelete'), disabled: pages.length === 1, onclick: () => deletePage(i) }, '✕'))));
  $('addPage').disabled = pages.length >= init.limits.pages;
}

function selectPage(i) {
  if (i === S.page) return;
  S.page = i;
  S.sel = null;
  render();
}

function addPage() {
  change(() => {
    S.panel.pages.push({ id: newPageId(), name: t('editor.pageName', { n: S.panel.pages.length + 1 }), layout: 'grid', buttons: [] });
    S.page = S.panel.pages.length - 1;
    S.sel = null;
  });
}

function movePage(i, d) {
  change(() => {
    const pages = S.panel.pages;
    [pages[i], pages[i + d]] = [pages[i + d], pages[i]];
    if (S.page === i) S.page = i + d; else if (S.page === i + d) S.page = i;
  });
}

function deletePage(i) {
  const p = S.panel.pages[i];
  if (p.buttons.length && !confirm(t('editor.pageDeleteConfirm', { name: p.name, count: p.buttons.length }))) return;
  change(() => {
    S.panel.pages.splice(i, 1);
    // Buttons that opened it now need another page
    for (const b of allButtons()) if (b.type === 'page' && b.page === p.id) b.page = '';
    S.page = Math.min(S.page, S.panel.pages.length - 1);
    S.sel = null;
  });
}

/* ---------- Buttons ---------- */

function createButton(col, row) {
  change(() => {
    const b = { id: newButtonId(), col, row, w: 1, h: 1, type: 'press', key: '' };
    page().buttons.push(b);
    S.sel = b.id;
  });
}

function deleteButton() {
  const b = selected();
  if (!b) return;
  change(() => {
    const p = page();
    p.buttons.splice(p.buttons.indexOf(b), 1);
    S.sel = null;
  });
}

// A copy in the first free place of the same size, scanning row by row
function duplicateButton() {
  const b = selected();
  if (!b) return;
  const { cols, rows } = S.panel.grid;
  for (let row = 0; row + b.h <= rows; row++) {
    for (let col = 0; col + b.w <= cols; col++) {
      if (!fits(col, row, b.w, b.h, null)) continue;
      change(() => {
        const copy = { ...JSON.parse(JSON.stringify(b)), id: newButtonId(), col, row };
        page().buttons.push(copy);
        S.sel = copy.id;
      });
      return;
    }
  }
  toast(t('editor.noRoom'), true);
}

function moveSelected(dc, dr) {
  const b = selected();
  if (!b || !fits(b.col + dc, b.row + dr, b.w, b.h, b.id)) return;
  change(() => { b.col += dc; b.row += dr; }, { coalesce: 'move:' + b.id });
}

function setType(b, type) {
  change(() => {
    const key = b.key || (b.keys && b.keys[0]) || '';
    b.type = type;
    delete b.key; delete b.keys; delete b.repeat; delete b.page;
    if (type !== 'toggle') delete b.alt;
    if (KEYED.includes(type)) b.key = key;
    if (type === 'repeat') b.repeat = 100;
    if (type === 'toggle') { b.keys = [key, '']; b.alt = {}; }
    if (type === 'page') b.page = S.panel.pages.find((p) => p.id !== page().id)?.id || 'back';
  });
}

// Changes the grid size, removing (after asking) the buttons that wouldn't fit any more
function setGrid(cols, rows) {
  const max = init.limits.grid;
  cols = Math.max(1, Math.min(max, Math.round(cols) || 1));
  rows = Math.max(1, Math.min(max, Math.round(rows) || 1));
  const out = allButtons().filter((b) => b.col + b.w > cols || b.row + b.h > rows);
  if (out.length && !confirm(t('editor.gridShrink', { count: out.length }))) { render(); return; }
  change(() => {
    S.panel.grid = { cols, rows };
    for (const p of S.panel.pages) p.buttons = p.buttons.filter((b) => !out.includes(b));
    if (!selected()) S.sel = null;
  });
}

/* ---------- Choosing keys ---------- */

function keyField(value, onChange, labelKey) {
  const capturing = S.capture && S.capture.field === labelKey;
  const box = h('div', { class: 'ed-keyfield' });
  const chooser = h('div', { class: 'ed-chooser', hidden: true });
  const { mods, key } = K.split(value);
  const checks = K.MODIFIERS.map((m) => h('label', { class: 'ed-check' },
    h('input', { type: 'checkbox', checked: mods.includes(m), onchange: () => apply() }), ' ', K.label(m, init.platform)));
  const select = h('select', { onchange: () => apply(), 'aria-label': t('editor.key') },
    h('option', { value: '' }, t('editor.noMainKey')),
    Object.entries(K.GROUPS).map(([group, names]) => h('optgroup', { label: t('keys.group.' + group) },
      names.map((n) => h('option', { value: n, selected: n === key }, K.label(n, init.platform))))));
  function apply() {
    const chosen = K.MODIFIERS.filter((m, i) => checks[i].querySelector('input').checked);
    onChange(K.join(chosen, select.value));
  }
  fill(chooser, h('div', { class: 'row' }, checks), select);
  return fill(box,
    h('div', { class: 'label' }, t(labelKey)),
    h('div', { class: 'ed-keyrow' },
      h('span', { class: 'key' + (value ? '' : ' empty') }, value ? K.label(value, init.platform) : t('editor.noKey')),
      h('button', {
        class: 'btn small' + (capturing ? ' primary' : ''),
        onclick: () => (capturing ? stopCapture() : startCapture(labelKey, onChange)),
      }, capturing ? t('editor.capturing') : t('editor.capture')),
      h('button', { class: 'btn small', onclick: () => { chooser.hidden = !chooser.hidden; } }, t('editor.chooseKey'))),
    chooser);
}

// "Capture" listens for the next key: a combo ends it at once; a modifier alone counts when it's
// released without another key (to hold Shift, say)
function startCapture(field, done) {
  S.capture = { field, done, peak: [] };
  renderProps();
}
function stopCapture() {
  S.capture = null;
  renderProps();
}
// Ends the capture with a combo. The properties are always drawn again: capturing the combo the
// button already had changes nothing in the panel, so change() alone wouldn't redraw them and the
// button would stay on "Press the keys…" with the capture already over.
function finishCapture(combo) {
  const { done } = S.capture;
  S.capture = null;
  done(combo);
  renderProps();
}
window.addEventListener('keydown', (e) => {
  if (!S.capture) return;
  e.preventDefault();
  e.stopPropagation();
  const r = K.fromEvent(e, init.platform);
  if (r.modifier !== undefined) {
    if (r.mods.length > S.capture.peak.length) S.capture.peak = r.mods;
    return;
  }
  if (r.unknown) { stopCapture(); toast(t('editor.keyUnknown', { key: r.unknown }), true); return; }
  finishCapture(r.combo);
}, true);
window.addEventListener('keyup', (e) => {
  if (!S.capture) return;
  e.preventDefault();
  const stillDown = [e.ctrlKey, e.shiftKey, e.altKey, e.metaKey].some(Boolean);
  if (!stillDown && S.capture.peak.length) finishCapture(K.join(S.capture.peak, ''));
}, true);
window.addEventListener('blur', () => { if (S.capture) stopCapture(); });

/* ---------- Properties of the selected button ---------- */

const field = (labelKey, control, hint) => h('div', { class: 'ed-prop' },
  h('label', null, t(labelKey)), control, hint ? h('div', { class: 'hint small' }, hint) : null);

function colorField(labelKey, obj, prop, fallback) {
  const on = !!obj[prop];
  return h('div', { class: 'ed-prop ed-color' },
    h('label', { class: 'ed-check' },
      h('input', { type: 'checkbox', checked: on, onchange: (e) => change(() => { if (e.target.checked) obj[prop] = fallback; else delete obj[prop]; }) }),
      ' ', t(labelKey)),
    on ? h('input', { type: 'color', value: obj[prop], oninput: (e) => change(() => { obj[prop] = e.target.value; }, { coalesce: 'color:' + prop, props: false }) }) : null);
}

function iconImg(name, color = '#e6f1fa') {
  const body = init.icons[name] || '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${body.replace(/#000/g, color)}</svg>`;
  return h('img', { src: 'data:image/svg+xml,' + encodeURIComponent(svg), alt: '' });
}

// Icon of a button or of a toggle's second state: none, one of LibreShard's, an emoji, or (imported)
// an image, which can only be removed here
function iconField(obj) {
  const icon = obj.icon;
  const kind = icon ? icon.kind : 'none';
  const set = (v) => change(() => { if (v) obj.icon = v; else delete obj.icon; });
  const tabs = h('div', { class: 'ed-seg' }, ['none', 'builtin', 'emoji'].map((k) => h('button', {
    class: 'btn small' + (kind === k ? ' on' : ''),
    onclick: () => { if (k !== kind) set(k === 'none' ? null : k === 'builtin' ? { kind: 'builtin', name: Object.keys(init.icons)[0] } : { kind: 'emoji', text: '⭐' }); },
  }, t('editor.icon.' + k))));
  let body = null;
  if (kind === 'builtin') {
    body = h('div', { class: 'ed-icons' }, Object.keys(init.icons).map((name) => h('button', {
      class: 'ed-iconbtn' + (icon.name === name ? ' on' : ''), title: name, 'aria-label': name,
      onclick: () => set({ kind: 'builtin', name }),
    }, iconImg(name))));
  } else if (kind === 'emoji') {
    body = h('input', {
      class: 'ed-emoji', value: icon.text, 'aria-label': t('editor.icon.emoji'),
      oninput: (e) => { const text = graphemes(e.target.value.trim(), 2); if (text) change(() => { obj.icon = { kind: 'emoji', text }; }, { coalesce: 'emoji', props: false }); },
    });
  } else if (kind === 'image') {
    body = h('div', { class: 'row' },
      S.images[icon.file] ? h('img', { class: 'ed-thumb', src: S.images[icon.file], alt: '' }) : null,
      h('button', { class: 'btn small', onclick: () => set(null) }, t('editor.icon.removeImage')));
  }
  return h('div', { class: 'ed-prop' }, h('label', null, t('editor.icon')), tabs, body);
}

function lookFields(obj, prefix) {
  return [
    field('editor.label', h('textarea', {
      rows: '2', maxlength: String(init.limits.text), value: obj.label || '',
      oninput: (e) => change(() => { if (e.target.value.trim()) obj.label = e.target.value; else delete obj.label; }, { coalesce: prefix + 'label', props: false }),
    })),
    iconField(obj),
    colorField('editor.buttonColor', obj, 'color', '#1a3150'),
    colorField('editor.textColor', obj, 'textColor', '#e6eef7'),
  ];
}

function renderProps() {
  const b = selected();
  const box = $('props');
  if (!b) {
    fill(box,
      h('h2', null, t('editor.button')),
      h('p', { class: 'hint' }, t('editor.selectHint')),
      h('h2', null, t('editor.keysTitle')),
      keysSummary());
    return;
  }
  const typeSelect = h('select', { onchange: (e) => setType(b, e.target.value) },
    (b.type === 'none' ? ['none', ...TYPES] : TYPES).map((ty) => h('option', { value: ty, selected: ty === b.type }, t('editor.type.' + ty))));
  const action = [];
  if (KEYED.includes(b.type)) {
    action.push(keyField(b.key, (v) => change(() => { b.key = v; }), 'editor.key'));
    if (b.type === 'repeat') {
      action.push(field('editor.repeatEvery', h('input', {
        type: 'number', class: 'ed-num', min: '50', max: '1000', step: '10', value: String(b.repeat || 100),
        onchange: (e) => change(() => { b.repeat = Math.max(50, Math.min(1000, Math.round(Number(e.target.value)) || 100)); }),
      })));
    }
  } else if (b.type === 'toggle') {
    const keys = b.keys || ['', ''];
    action.push(keyField(keys[0], (v) => change(() => { b.keys = [v, keys[1]]; }), 'editor.toggleKey1'));
    action.push(keyField(keys[1], (v) => change(() => { b.keys = [keys[0], v]; }), 'editor.toggleKey2'));
  } else if (b.type === 'page') {
    action.push(field('editor.pageTarget', h('select', { onchange: (e) => change(() => { b.page = e.target.value; }) },
      h('option', { value: '', selected: !b.page }, '—'),
      S.panel.pages.map((p) => h('option', { value: p.id, selected: b.page === p.id }, p.name)),
      ['back', 'next', 'prev'].map((v) => h('option', { value: v, selected: b.page === v }, t('editor.page.' + v))))));
  }
  const typeHint = t('editor.typeHint.' + b.type);
  fill(box,
    h('div', { class: 'ed-props-head' },
      h('h2', null, t('editor.button')),
      h('button', { class: 'btn small', onclick: duplicateButton, title: 'Ctrl+D' }, t('editor.duplicate')),
      h('button', { class: 'btn small danger', onclick: deleteButton, title: t('editor.deleteKey') }, t('editor.delete'))),
    b.note ? h('div', { class: 'warnbox warn' }, b.note) : null,
    field('editor.type', typeSelect, typeHint),
    action,
    h('h2', null, b.type === 'toggle' ? t('editor.look1') : t('editor.look')),
    lookFields(b, ''),
    h('div', { class: 'ed-prop ed-pair' },
      h('label', null, t('editor.labelPos')),
      h('select', { onchange: (e) => change(() => { if (e.target.value) b.labelPos = e.target.value; else delete b.labelPos; }) },
        ['', 'top', 'middle', 'bottom'].map((v) => h('option', { value: v, selected: (b.labelPos || '') === v }, t('editor.labelPos.' + (v || 'auto'))))),
      h('label', null, t('editor.labelSize')),
      h('select', { onchange: (e) => change(() => { if (e.target.value !== 'm') b.labelSize = e.target.value; else delete b.labelSize; }) },
        ['s', 'm', 'l'].map((v) => h('option', { value: v, selected: (b.labelSize || 'm') === v }, t('editor.labelSize.' + v))))),
    b.type === 'toggle' ? [h('h2', null, t('editor.look2')), lookFields(b.alt, 'alt-')] : null,
    h('h2', null, t('editor.sizeTitle')),
    h('div', { class: 'ed-prop ed-pair' },
      h('label', null, t('editor.width')),
      h('input', { type: 'number', class: 'ed-num', min: '1', max: String(S.panel.grid.cols), value: String(b.w), onchange: (e) => resize(b, Number(e.target.value), b.h) }),
      h('label', null, t('editor.height')),
      h('input', { type: 'number', class: 'ed-num', min: '1', max: String(S.panel.grid.rows), value: String(b.h), onchange: (e) => resize(b, b.w, Number(e.target.value)) })),
  );
}

function resize(b, w, h2) {
  w = Math.max(1, Math.round(w) || 1);
  h2 = Math.max(1, Math.round(h2) || 1);
  if (!fits(b.col, b.row, w, h2, b.id)) { toast(t('editor.noRoom'), true); renderProps(); return; }
  change(() => { b.w = w; b.h = h2; });
}

/* ---------- Warnings ---------- */

let checkTimer = null;
function scheduleCheck() {
  clearTimeout(checkTimer);
  checkTimer = setTimeout(async () => {
    const r = await api.check(keysInUse());
    if (r && r.ok) { S.check = r; renderWarnings(); if (!selected()) renderProps(); }
  }, 150);
}

function keysSummary() {
  const keys = keysInUse();
  if (!keys.length) return h('p', { class: 'hint small' }, t('editor.noKeysYet'));
  const dangerous = new Set(S.check ? S.check.risk.dangerous : []);
  return h('div', { class: 'keys' }, keys.map((k) => h('span', { class: 'key' + (dangerous.has(k) ? ' danger' : '') }, K.label(k, init.platform))));
}

function renderWarnings() {
  const out = [];
  const missing = allButtons().filter(incomplete).length;
  if (missing) out.push(h('div', { class: 'warnbox warn' }, t('editor.incomplete', { count: missing })));
  const risk = S.check && S.check.risk;
  if (risk) {
    if (risk.warning) out.push(h('div', { class: 'warnbox danger' }, t('risk.warning')));
    else {
      if (risk.dangerous.length) out.push(h('div', { class: 'warnbox warn' }, t('risk.system')));
      if (risk.canType) out.push(h('div', { class: 'warnbox warn' }, t('risk.canType')));
    }
  }
  if (S.check && S.check.unavailable.length) out.push(h('div', { class: 'warnbox warn' }, t('editor.unavailable', { keys: S.check.unavailable.join(', ') })));
  const keyCount = keysInUse().length;
  if (keyCount > init.limits.keys) out.push(h('div', { class: 'warnbox danger' }, t('editor.tooManyKeys', { count: keyCount, max: init.limits.keys })));
  if (S.small.length) out.push(h('div', { class: 'warnbox warn' }, t('editor.small', { count: S.small.length })));
  if (S.loadWarnings.length) out.push(h('div', { class: 'warnbox warn' }, t('editor.loadWarnings', { details: S.loadWarnings.slice(0, 3).join('; ') })));
  fill($('warnings'), out);
}

/* ---------- Saving and closing ---------- */

async function save() {
  if (!S.meta.name.trim()) { toast(t('editor.nameRequired'), true); $('name').focus(); return; }
  for (const [i, p] of S.panel.pages.entries()) {
    const b = p.buttons.find(incomplete);
    if (b) {
      S.page = i;
      S.sel = b.id;
      render();
      toast(t('editor.incompleteSave'), true);
      return;
    }
  }
  const r = await api.save(S.panel, S.meta);
  if (!r || r.ok === false) { toast(((r && r.errors) || [t('error.generic')]).join('\n'), true); return; }
  const first = !S.id;
  S.id = r.id;
  S.saved = snapshot();
  S.loadWarnings = [];
  render({ props: false });
  toast(first ? t('editor.savedNew') : t('editor.saved'));
}

/* ---------- Shortcuts ---------- */

function shortcut({ key, ctrl, shift }) {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if (ctrl && (key === 'z' || key === 'Z') && !shift) { if (!typing) undo(); return !typing; }
  if (ctrl && (key === 'y' || ((key === 'z' || key === 'Z') && shift))) { if (!typing) redo(); return !typing; }
  if (ctrl && (key === 's' || key === 'S')) { save(); return true; }
  if (typing) return false;
  if (ctrl && (key === 'd' || key === 'D')) { duplicateButton(); return true; }
  if (key === 'Delete' || key === 'Backspace') { deleteButton(); return true; }
  if (key === 'Escape') { S.sel = null; render(); return true; }
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (arrows[key] && selected()) { moveSelected(...arrows[key]); return true; }
  return false;
}
window.addEventListener('keydown', (e) => {
  if (S.capture) return;
  if (shortcut({ key: e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey })) e.preventDefault();
});

/* ---------- The canvas ---------- */

window.addEventListener('message', (e) => {
  if (e.source !== $('preview').contentWindow || !e.data) return;
  const d = e.data;
  if (d.t === 'ready') { S.previewReady = true; sendPreview(); return; }
  if (S.capture) stopCapture();
  if (d.t === 'select') {
    if (S.sel !== d.id) { S.sel = typeof d.id === 'string' ? d.id : null; S.coalesce = null; render(); }
  } else if (d.t === 'create') {
    if (fits(d.col, d.row, 1, 1, null)) createButton(d.col, d.row);
  } else if (d.t === 'move') {
    const b = page().buttons.find((x) => x.id === d.id);
    if (b && fits(d.col, d.row, b.w, b.h, b.id)) change(() => { b.col = d.col; b.row = d.row; S.sel = b.id; });
  } else if (d.t === 'resize') {
    const b = page().buttons.find((x) => x.id === d.id);
    if (b && fits(b.col, b.row, d.w, d.h, b.id)) change(() => { b.w = d.w; b.h = d.h; S.sel = b.id; });
  } else if (d.t === 'page') {
    const i = S.panel.pages.findIndex((p) => p.id === d.id);
    if (i >= 0) selectPage(i);
  } else if (d.t === 'small') {
    S.small = Array.isArray(d.ids) ? d.ids : [];
    renderWarnings();
  } else if (d.t === 'key') {
    shortcut(d);
  }
});

// Nothing can be dropped on the editor
for (const type of ['dragover', 'drop']) window.addEventListener(type, (e) => e.preventDefault());

/* ---------- Start ---------- */

async function start() {
  init = await api.init();
  if (!init || init.ok === false) { document.body.textContent = (init && init.errors || ['?']).join('\n'); return; }
  document.documentElement.lang = init.locale;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  S.id = init.id;
  S.meta = init.meta;
  S.panel = init.panel;
  S.images = init.images || {};
  S.loadWarnings = init.warnings || [];
  // Every toggle has an object for its second state (an empty one isn't saved by the format)
  for (const b of allButtons()) if (b.type === 'toggle' && !b.alt) b.alt = {};
  S.saved = snapshot();

  $('name').addEventListener('input', (e) => change(() => { S.meta.name = e.target.value; }, { coalesce: 'name', props: false }));
  $('icon').addEventListener('input', (e) => change(() => { S.meta.icon = graphemes(e.target.value.trim(), 2); }, { coalesce: 'icon', props: false }));
  $('icon').addEventListener('change', () => { $('icon').value = S.meta.icon; });
  $('cols').addEventListener('change', (e) => setGrid(Number(e.target.value), S.panel.grid.rows));
  $('rows').addEventListener('change', (e) => setGrid(S.panel.grid.cols, Number(e.target.value)));
  $('size').addEventListener('change', (e) => { S.size = e.target.value; layoutPreview(); });
  $('pageBar').addEventListener('change', (e) => change(() => { if (e.target.checked) delete S.panel.pageBar; else S.panel.pageBar = false; }));
  $('addPage').addEventListener('click', addPage);
  $('undo').addEventListener('click', undo);
  $('redo').addEventListener('click', redo);
  $('save').addEventListener('click', save);
  $('close').addEventListener('click', () => api.close());
  document.addEventListener('focusout', () => { S.coalesce = null; });

  new ResizeObserver(layoutPreview).observe($('stage'));
  layoutPreview();
  render();
  // The canvas may have loaded before this page listened: ask it to say it's ready again
  $('preview').contentWindow.postMessage({ t: 'hello' }, '*');
}

start();
