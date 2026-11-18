// LibreShard's desktop window. It talks to the main process only through window.libreshard (preload.js).
// Everything that comes from manifests or devices is rendered as text, never as HTML.
const api = window.libreshard;
let state = null;
let tab = 'connect';
let clockOffset = 0; // main process clock minus ours, for the code countdown

const $ = (id) => document.getElementById(id);

function t(key, vars = {}) {
  const s = (state && state.strings[key]) || key;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

// h('div', { class: 'x', onclick: fn }, 'text', child…). Strings become text nodes.
function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'value' || k === 'checked') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  return fill(el, ...children);
}

// Replaces an element's content. Unlike replaceChildren(), it skips null/false (optional parts)
// instead of turning them into the text "null".
function fill(el, ...children) {
  el.replaceChildren(...children.flat(Infinity)
    .filter((c) => c !== null && c !== undefined && c !== false)
    .map((c) => (c instanceof Node ? c : String(c))));
  return el;
}

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(state.locale) : '—');
const fmtSize = (bytes) => (bytes < 1024 * 1024 ? Math.max(1, Math.round(bytes / 1024)) + ' KB' : (bytes / 1024 / 1024).toFixed(1) + ' MB');
const iconText = (m) => (m.icon ? [...String(m.icon)].slice(0, 2).join('') : String(m.name || m.id).trim().charAt(0).toUpperCase());

let toastTimer;
function toast(text, error = false) {
  const el = $('toast');
  el.textContent = text;
  el.className = 'toast' + (error ? ' error' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, error ? 8000 : 3500);
}

// Calls the main process; shows its error (if any) instead of failing silently
async function call(fn, ...args) {
  try {
    const r = await fn(...args);
    if (r && r.ok === false) toast((r.errors || [t('error.generic')]).join('\n'), true);
    return r;
  } catch (e) {
    toast(e.message || String(e), true);
    return { ok: false };
  }
}

/* ---------- Header, banners and tabs ---------- */

// Shards that no longer come with LibreShard: one notice with an Install button for each (the
// gallery's usual download and review), until each is installed again or the user says no
let movedBusy = null;
function renderMoved() {
  const list = state.moved;
  $('moved').hidden = !list.length;
  if (!list.length) return;
  const names = list.map((m) => (m.was ? t('moved.renamed', { was: m.was, name: m.name }) : m.name));
  const joined = names.length > 1 ? t('moved.and', { first: names.slice(0, -1).join(', '), last: names[names.length - 1] }) : names[0];
  $('movedText').textContent = t(list.length > 1 ? 'moved.many' : 'moved.one', { names: joined });
  fill($('movedActions'),
    ...list.map((m) => h('button', { class: 'btn small primary', disabled: !!movedBusy, onclick: () => movedInstall(m.id) },
      movedBusy === m.id ? t('gallery.downloading') : t('moved.install', { name: m.name }))),
    h('button', { class: 'btn small', disabled: !!movedBusy, onclick: () => call(api.movedDismiss) }, t('moved.dismiss')));
}
async function movedInstall(id) {
  movedBusy = id;
  renderMoved();
  const r = await call(api.galleryInstall, id);
  movedBusy = null;
  renderMoved();
  if (r && r.ok && r.review) review(r.review, 'install');
}

function renderChrome() {
  const status = $('status');
  status.textContent = state.paused ? t('status.paused') : t('status.active', { count: state.devices.length });
  status.className = 'status' + (state.paused ? ' paused' : '');
  const pause = $('pause');
  pause.textContent = state.paused ? t('action.resume') : t('action.pause');
  pause.className = 'btn' + (state.paused ? ' paused' : '');
  pause.title = t('action.pauseHint');

  const alertOn = state.alertAt && Date.now() + clockOffset - state.alertAt < 5 * 60 * 1000;
  $('alert').hidden = !alertOn;
  $('alert').textContent = t('alert.pairingAttempts');
  $('restart').hidden = !state.restartNeeded;
  $('update').hidden = !state.update.show;
  renderMoved();
  // Never at the same time as the new version notice or the moved shards one
  $('support').hidden = !state.supportAsk || state.update.show || state.moved.length > 0;
  if (state.update.show) $('updateText').textContent = t('update.available', { version: state.update.latest });

  $('devCount').textContent = state.devices.length || '';
  const attention = state.shards.filter((s) => s.pendingKeys.length).length + state.rejected.length;
  $('shardWarn').textContent = attention || '';

  for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== 'tab-' + tab;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
}

/* ---------- Connect ---------- */

function renderConnect() {
  const p = $('tab-connect');
  const qrs = state.pairing.qrs.map((q) => h('div', { class: 'qr' },
    h('img', { src: q.dataUrl, alt: '' }),
    h('b', null, q.name + (q.vpn ? ' (VPN)' : '')),
    h('span', null, q.url)));
  fill(p,
    h('p', null, t('connect.intro')),
    qrs.length ? null : h('p', { class: 'empty' }, t('connect.noNetwork')),
    // The shards on this PC's own screen (a touch monitor), in a window that never takes the focus
    h('div', { class: 'qrs' }, qrs,
      h('button', { class: 'qr here', onclick: () => call(api.openPanel) },
        h('img', { src: 'monitor.svg', alt: '' }),
        h('b', null, t('connect.thisPc')),
        h('span', null, t('connect.thisPcHint')))),
    h('h2', null, t('connect.codeTitle')),
    h('div', { class: 'code' }, state.pairing.code),
    h('p', { class: 'hint small', id: 'countdown' }),
  );
  tick();
}

function tick() {
  const el = $('countdown');
  if (!el || !state) return;
  const left = Math.max(0, Math.round((state.pairing.expiresAt - (Date.now() + clockOffset)) / 1000));
  const mm = Math.floor(left / 60);
  const ss = String(left % 60).padStart(2, '0');
  el.textContent = t('connect.codeHint', { time: `${mm}:${ss}` });
}
setInterval(() => { tick(); if (state) renderChrome(); }, 1000);

/* ---------- Devices ---------- */

function renderDevices() {
  const p = $('tab-devices');
  const rows = state.devices.map((d) => h('div', { class: 'item' },
    h('div', { class: 'item-head' },
      h('div', { class: 'grow' },
        h('input', {
          class: 'device-name', value: d.name, maxlength: '60', 'aria-label': t('devices.name'),
          onchange: (e) => call(api.renameDevice, d.id, e.target.value),
          onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
        }),
        h('div', { class: 'meta' },
          d.local ? h('span', { class: 'badge local' }, t('devices.localBadge')) : null,
          t('devices.meta', { created: fmtDate(d.createdAt), seen: fmtDate(d.lastSeen), ip: d.lastIp || '—' }))),
      h('button', { class: 'btn danger small', onclick: () => call(api.removeDevice, d.id) }, t('devices.remove')))));
  fill(p,
    h('p', null, t('devices.intro')),
    rows.length ? h('div', { class: 'list' }, rows) : h('p', { class: 'empty' }, t('devices.none')),
    h('h2', null, t('devices.security')),
    toggle('confirmDevices', t('settings.confirmDevices'), t('settings.confirmDevicesHint')),
  );
}

/* ---------- Shards ---------- */

function renderShards() {
  const p = $('tab-shards');
  if (gal) { renderGallery(p); return; }
  const pending = state.shards.filter((s) => s.pendingKeys.length);
  const updatable = state.shards.filter((s) => s.gallery && s.gallery.update);
  const cards = state.shards.map(shardCard);
  const rejected = state.rejected.map((r) => h('div', { class: 'item attention' },
    h('div', { class: 'name' }, r.folder),
    h('ul', { class: 'error-list' }, r.errors.map((e) => h('li', null, e))),
    h('div', { class: 'actions' }, h('button', { class: 'btn small', onclick: () => api.openPath('shard', r.root) }, t('shards.openFolder')))));

  const tile = (cls, icon, title, sub, onclick) => h('button', { class: 'tile ' + cls, onclick },
    h('span', { class: 'tile-ico' }, svgIcon(icon)),
    h('span', { class: 'tile-text' }, h('span', { class: 'tile-title' }, title), h('span', { class: 'tile-sub' }, sub)));
  const iconBtn = (icon, label, onclick, small) => h('button', { class: 'btn with-ico' + (small ? ' small' : ''), onclick }, svgIcon(icon), label);
  fill(p,
    h('div', { class: 'shards-start' },
      tile('gallery', 'gallery', t('shards.explore'), t('shards.galleryHint'), () => openGallery(false)),
      tile('create', 'plus', t('shards.newPanel'), t('shards.newHint'), () => call(api.openEditor))),
    h('p', { class: 'hint small' }, t('shards.aiHint'), ' ',
      h('button', { class: 'btn small with-ico', onclick: () => call(api.openLink, 'aiGuide') }, svgIcon('spark'), t('shards.aiGuide'))),
    h('div', { class: 'group' },
      h('div', { class: 'group-label' }, t('shards.installGroup')),
      h('div', { class: 'row' },
        iconBtn('file', t('shards.installZip'), () => install('zip')),
        iconBtn('link', t('shards.installUrl'), installFromUrl),
        iconBtn('folder', t('shards.installFolder'), () => install('folder')),
        iconBtn('import', t('shards.importStreamDeck'), () => call(api.importStreamDeck))),
      h('p', { class: 'hint small' }, t('shards.dropHint'))),
    h('div', { class: 'group' },
      h('div', { class: 'group-label' }, t('shards.authorsGroup')),
      h('div', { class: 'row' },
        iconBtn('code', t('shards.loadDev'), () => install('dev'), true),
        iconBtn('folderOpen', t('shards.openShardsFolder'), () => api.openPath('shards'), true))),
    pending.length ? h('div', { class: 'warnbox warn' }, t('shards.pendingIntro', { count: pending.length })) : null,
    updatable.length ? h('div', { class: 'warnbox info' }, t('shards.updatesIntro', { count: updatable.length })) : null,
    h('h2', null, t('shards.installed')),
    h('p', { class: 'hint small' }, t('shards.orderHint')),
    h('div', { class: 'list' }, cards),
    rejected.length ? h('h2', null, t('shards.rejected')) : null,
    rejected.length ? h('div', { class: 'list' }, rejected) : null,
  );
}

function shardCard(s) {
  const origin = s.bundled ? t('shards.bundled') : s.linked ? t('shards.linked') : s.panel ? t('shards.panelBadge') : t('shards.userInstalled');
  const risky = s.risk.warning ? h('span', { class: 'badge danger' }, t('risk.badgeWarning'))
    : s.risk.dangerous.length ? h('span', { class: 'badge warn' }, t('risk.badgeSystem')) : null;
  return h('div', { class: 'item' + (s.pendingKeys.length ? ' attention' : '') + (s.enabled ? '' : ' off') },
    h('div', { class: 'item-head' },
      h('div', { class: 'ico' }, iconText(s)),
      h('div', { class: 'grow' },
        h('div', null,
          h('span', { class: 'name' }, s.name || s.id),
          h('span', { class: 'badge' }, origin),
          s.enabled ? null : h('span', { class: 'badge off' }, t('shards.disabled')),
          s.pendingKeys.length ? h('span', { class: 'badge warn' }, t('shards.pendingBadge')) : null,
          s.gallery && s.gallery.update ? h('span', { class: 'badge warn' }, t('gallery.updateBadge', { version: s.gallery.update })) : null,
          s.gallery && s.gallery.gone ? h('span', { class: 'badge off' }, t('shards.galleryGone')) : null,
          risky),
        h('div', { class: 'meta' }, [
          s.version ? 'v' + s.version : null,
          s.author ? t('shards.by', { author: s.author }) : null,
          t('shards.keyCount', { count: s.keys.length }),
          s.apps.length ? t('shards.onlyIn', { apps: s.apps.join(', ') }) : t('shards.anyApp'),
          s.license ? t('shards.license', { license: s.license }) : null,
          s.source && s.source.kind === 'url' ? t('shards.from', { host: s.source.host }) : null,
          s.source && s.source.kind === 'gallery' ? t('shards.fromGallery') : null,
          s.copyOf ? t('shards.copyOf', { name: s.copyOf.name || s.copyOf.id, version: s.copyOf.version || '?' }) : null,
        ].filter(Boolean).join(' · '))),
      h('div', { class: 'order' },
        h('button', { class: 'icon-btn star' + (s.favorite ? ' on' : ''), title: s.favorite ? t('shards.unfavorite') : t('shards.favorite'),
          'aria-label': s.favorite ? t('shards.unfavorite') : t('shards.favorite'), 'aria-pressed': String(s.favorite),
          onclick: () => call(api.setShardFavorite, s.id, !s.favorite) }, s.favorite ? '★' : '☆'),
        h('button', { class: 'icon-btn', title: t('shards.moveUp'), 'aria-label': t('shards.moveUp'), onclick: () => call(api.moveShard, s.id, -1) }, '↑'),
        h('button', { class: 'icon-btn', title: t('shards.moveDown'), 'aria-label': t('shards.moveDown'), onclick: () => call(api.moveShard, s.id, 1) }, '↓'))),
    s.description ? h('div', { class: 'desc' }, s.description) : null,
    h('div', { class: 'actions' },
      s.pendingKeys.length ? h('button', { class: 'btn primary small', onclick: () => review(approvalView(s), 'approve') }, t('shards.review')) : null,
      galleryUpdateButton(s),
      // Someone else's panel opens in the editor as a copy: the button says so before it's clicked
      s.panel ? h('button', { class: 'btn small', title: s.ownPanel ? null : t('shards.editCopyHint'), onclick: () => call(api.openEditor, s.id) },
        s.ownPanel ? t('shards.edit') : t('shards.editCopy')) : null,
      h('button', { class: 'btn small', onclick: () => review(approvalView(s), 'view') }, t('shards.permissions')),
      h('button', { class: 'btn small', onclick: () => appsEditor(s) }, t('shards.apps')),
      s.settingsSchema.length ? h('button', { class: 'btn small', onclick: () => settingsEditor(s) }, t('shards.settings')) : null,
      h('button', { class: 'btn small', onclick: () => call(api.setShardEnabled, s.id, !s.enabled) }, s.enabled ? t('shards.disable') : t('shards.enable')),
      s.url ? h('button', { class: 'btn small', title: s.url, onclick: () => call(api.openShardPage, { shard: s.id }) }, t('shards.page')) : null,
      h('button', { class: 'btn small', onclick: () => api.openShardFolder(s.id) }, t('shards.openFolder')),
      s.bundled || s.linked ? null : h('button', { class: 'btn small', onclick: () => exportShard(s) }, t('shards.export')),
      s.bundled ? null : h('button', { class: 'btn danger small', onclick: () => call(api.uninstallShard, s.id) }, t('shards.uninstall'))));
}

const approvalView = (s) => ({
  manifest: { id: s.id, name: s.name, author: s.author, version: s.version, icon: s.icon, description: s.description, apps: s.apps, keys: s.keys, license: s.license, url: s.url },
  risk: s.risk,
  newKeys: s.pendingKeys,
  linked: s.linked,
});

// "Version x available" on a card: update from the gallery (the usual review of changes), or go to
// the author's shop for a paid shard
function galleryUpdateButton(s) {
  const g = s.gallery;
  if (!g || !g.update || g.needsApp) return null;
  if (g.paid) return h('button', { class: 'btn primary small', onclick: () => call(api.galleryOpen, s.id, 'buy') }, t('gallery.toShop'));
  return h('button', {
    class: 'btn primary small',
    onclick: async (ev) => {
      ev.target.disabled = true;
      ev.target.textContent = t('gallery.downloading');
      const r = await call(api.galleryInstall, s.id);
      if (r && r.ok && r.review) review(r.review, 'install');
      else renderShards();
    },
  }, t('gallery.update'));
}

async function exportShard(s) {
  const r = await call(api.exportShard, s.id);
  if (r && r.ok && r.saved) toast(t('export.saved', { name: s.name || s.id }));
}

/* ---------- Icons ---------- */

// Small line icons for buttons (24×24, drawn with the text color)
const ICONS = {
  gallery: '<rect x="3" y="3" width="7.5" height="7.5" rx="2"/><rect x="13.5" y="3" width="7.5" height="7.5" rx="2"/><rect x="3" y="13.5" width="7.5" height="7.5" rx="2"/><path d="M17.25 13.5l1.1 2.4 2.4 1.1-2.4 1.1-1.1 2.4-1.1-2.4-2.4-1.1 2.4-1.1z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14l3 3 3-3"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  folderOpen: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1"/><path d="M3 19l2.5-7.5A2 2 0 0 1 7.4 10H21l-2.6 7.7a2 2 0 0 1-1.9 1.3H5a2 2 0 0 1-2-2z"/>',
  import: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 8h2M14 8h2M8 12h2M14 12h2M12 18v3M9 21h6"/>',
  code: '<path d="M9 7l-5 5 5 5M15 7l5 5-5 5"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 15l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
};
function svgIcon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'ico-svg');
  svg.innerHTML = ICONS[name]; // our own constant markup, never data
  return svg;
}

/* ---------- Gallery ---------- */

// The shards reviewed for LibreShard's gallery, listed in the Shards tab. Its list comes from
// libreshard.com when it opens (the main process keeps it 10 minutes); installing downloads the
// reviewed file and shows the usual review.
let gal = null; // { q, tag, loading, error, entries, busy } while the gallery is open
const GAL_TAGS = ['games', 'streaming', 'creative', 'video', 'audio', 'office', 'development', 'desktop', 'accessibility', 'other'];

async function openGallery(refresh) {
  gal = gal || { q: '', tag: '', entries: null, busy: null };
  gal.loading = true;
  gal.error = null;
  if (tab === 'shards') renderShards();
  const r = await api.galleryList({ refresh });
  if (!gal) return;
  gal.loading = false;
  if (r && r.ok) gal.entries = r.entries;
  else gal.error = ((r && r.errors) || [t('error.generic')]).join(' ');
  if (tab === 'shards') renderShards();
}

async function galleryInstall(e) {
  gal.busy = e.id;
  renderShards();
  const r = await call(api.galleryInstall, e.id);
  if (gal) gal.busy = null;
  if (tab === 'shards') renderShards();
  if (r && r.ok && r.review) review(r.review, 'install');
}

function galleryCard(e) {
  const busy = gal.busy === e.id;
  const taken = e.installed && !e.installed.same;
  const status = e.paid ? h('span', { class: 'badge' }, t('gallery.paid', { price: e.price })) : h('span', { class: 'badge' }, t('gallery.free'));
  const risky = e.risk.warning ? h('span', { class: 'badge danger' }, t('risk.badgeWarning'))
    : e.risk.dangerous.length ? h('span', { class: 'badge warn' }, t('risk.badgeSystem')) : null;
  let action = null;
  if (e.paid) action = h('button', { class: 'btn small primary', onclick: () => call(api.galleryOpen, e.id, 'buy') }, t('gallery.buy'));
  else if (e.needsApp || taken) action = null;
  else if (e.update) action = h('button', { class: 'btn small primary', disabled: busy, onclick: () => galleryInstall(e) }, busy ? t('gallery.downloading') : t('gallery.update'));
  else if (!e.installed) action = h('button', { class: 'btn small primary', disabled: busy, onclick: () => galleryInstall(e) }, busy ? t('gallery.downloading') : t('gallery.install'));
  return h('div', { class: 'item' },
    h('div', { class: 'item-head' },
      h('div', { class: 'ico' }, iconText(e)),
      h('div', { class: 'grow' },
        h('div', null,
          h('span', { class: 'name' }, e.name),
          status,
          e.update ? h('span', { class: 'badge warn' }, t('gallery.updateBadge', { version: e.version }))
            : e.installed && e.installed.same ? h('span', { class: 'badge' }, t('gallery.installed')) : null,
          e.needsApp ? h('span', { class: 'badge off' }, t('gallery.needsAppBadge', { version: e.minAppVersion })) : null,
          risky),
        h('div', { class: 'meta' }, [
          'v' + e.version,
          t('shards.by', { author: e.author }),
          t('shards.keyCount', { count: e.keys.length }),
          e.apps.length ? t('shards.onlyIn', { apps: e.apps.join(', ') }) : t('shards.anyApp'),
          t('shards.license', { license: e.license }),
        ].join(' · ')))),
    h('div', { class: 'desc' }, e.description),
    taken ? h('div', { class: 'hint small' }, t('gallery.idTaken')) : null,
    h('div', { class: 'actions' },
      action,
      h('button', { class: 'btn small', onclick: () => review({ manifest: { ...e, url: undefined }, risk: e.risk }, 'view') }, t('shards.permissions')),
      e.url ? h('button', { class: 'btn small', title: e.url, onclick: () => call(api.galleryOpen, e.id, 'page') }, t('gallery.page')) : null));
}

function renderGallery(p) {
  const q = gal.q.trim().toLowerCase();
  const list = (gal.entries || []).filter((e) => (!gal.tag || e.tags.includes(gal.tag)) &&
    (!q || [e.name, e.author, e.description, ...e.apps, ...e.tags.map((x) => t('gallery.tag.' + x))].join(' ').toLowerCase().includes(q)));
  const search = h('input', { type: 'search', class: 'grow-input', placeholder: t('gallery.search'), value: gal.q,
    oninput: (ev) => { gal.q = ev.target.value; renderShards(); const s = $('galSearch'); if (s) { s.focus(); s.setSelectionRange(s.value.length, s.value.length); } } });
  search.id = 'galSearch';
  fill(p,
    h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => { gal = null; renderShards(); } }, t('gallery.back')),
      h('h2', { class: 'grow gal-title with-ico' }, svgIcon('gallery'), t('gallery.title')),
      h('button', { class: 'btn small', disabled: gal.loading, onclick: () => openGallery(true) }, t('gallery.refresh'))),
    h('p', { class: 'hint small' }, t('gallery.intro'), ' ',
      h('button', { class: 'btn small', onclick: () => call(api.openLink, 'galleryPublish') }, t('gallery.publish'))),
    h('div', { class: 'row' },
      search,
      h('select', { onchange: (ev) => { gal.tag = ev.target.value; renderShards(); } },
        h('option', { value: '', selected: !gal.tag }, t('gallery.allTags')),
        GAL_TAGS.map((x) => h('option', { value: x, selected: gal.tag === x }, t('gallery.tag.' + x))))),
    gal.loading && !gal.entries ? h('p', { class: 'hint' }, t('gallery.loading')) : null,
    gal.error ? h('div', { class: 'warnbox warn' }, gal.error, ' ', h('button', { class: 'btn small', onclick: () => openGallery(true) }, t('gallery.retry'))) : null,
    gal.entries && !list.length ? h('p', { class: 'hint' }, t('gallery.empty')) : null,
    h('div', { class: 'list' }, list.map(galleryCard)));
}

// "Install from URL…": an address, then the download and the usual review
function installFromUrl() {
  const input = h('input', { type: 'url', class: 'url-input', placeholder: 'https://…', spellcheck: 'false', autocomplete: 'off' });
  const go = h('button', { class: 'btn primary', type: 'submit' }, t('url.download'));
  const cancel = h('button', { class: 'btn', type: 'button', onclick: closeModal }, t('action.cancel'));
  const form = h('form', {
    onsubmit: async (e) => {
      e.preventDefault();
      if (!input.value.trim()) { input.focus(); return; }
      go.disabled = true;
      input.disabled = true;
      go.textContent = t('url.downloading');
      const r = await call(api.installFromUrl, input.value.trim());
      go.disabled = false;
      input.disabled = false;
      go.textContent = t('url.download');
      if (r && r.ok && r.review) review(r.review, 'install');
    },
  },
  h('div', { class: 'label' }, t('url.title')),
  h('p', { class: 'hint small' }, t('url.hint')),
  input,
  h('div', { class: 'buttons' }, cancel, go));
  fill($('dialog'), form);
  $('modal').hidden = false;
  $('modal').onclick = (e) => { if (e.target === $('modal') && !go.disabled) closeModal(); };
  input.focus();
}

async function install(kind) {
  const r = await call(kind === 'dev' ? api.pickDevInstall : api.pickInstall, kind);
  if (r && r.ok && r.review) review(r.review, 'install');
}

/* ---------- Review dialog (install, approve, or just look) ---------- */

function closeModal() { $('modal').hidden = true; }

function review(data, mode) {
  const m = data.manifest;
  const isNew = (k) => (data.newKeys || data.update?.addedKeys || []).includes(k);
  const keyChip = (k, danger) => h('span', { class: 'key' + (danger ? ' danger' : '') + (isNew(k) && mode !== 'view' ? ' new' : '') }, k);
  const warnings = [];
  if (data.risk.warning) warnings.push(h('div', { class: 'warnbox danger' }, t('risk.warning')));
  else {
    if (data.risk.dangerous.length) warnings.push(h('div', { class: 'warnbox warn' }, t('risk.system')));
    if (data.risk.canType) warnings.push(h('div', { class: 'warnbox warn' }, t('risk.canType')));
  }
  if (!m.apps || !m.apps.length) warnings.push(h('div', { class: 'hint small' }, t('risk.noApps')));

  const cancel = () => { if (mode === 'install') api.cancelInstall(data.id); closeModal(); };
  const confirm = async () => {
    const r = mode === 'install' ? await call(api.confirmInstall, data.id) : await call(api.approveShard, m.id);
    if (r && r.ok) {
      closeModal();
      toast(mode === 'install' ? t('shards.installed.toast', { name: m.name || m.id }) : t('shards.approved.toast', { name: m.name || m.id }));
      tab = 'shards';
      if (gal) openGallery(false); // its "installed" marks change
    }
  };

  const installTitle = data.link ? t('review.linkTitle') : data.update ? t('review.updateTitle') : t('review.installTitle');
  const title = { install: installTitle, approve: t('review.approveTitle'), view: t('review.viewTitle') }[mode];
  fill($('dialog'),
    h('div', { class: 'label' }, title),
    h('div', { class: 'item-head' },
      h('div', { class: 'ico' }, iconText(m)),
      h('div', { class: 'grow' },
        h('h3', null, m.name || m.id),
        h('div', { class: 'meta' }, [m.version ? 'v' + m.version : null, m.author ? t('shards.by', { author: m.author }) : null, m.id].filter(Boolean).join(' · ')))),
    m.description ? h('div', { class: 'desc' }, m.description) : null,
    data.link ? h('div', { class: 'hint small' }, t('review.linkNote')) : null,
    data.source && data.source.kind === 'url' ? h('div', { class: 'hint small' }, t('review.source', { host: data.source.host })) : null,
    data.source && data.source.kind === 'gallery' ? h('div', { class: 'hint small' }, t('review.fromGallery')) : null,
    data.update ? h('div', { class: 'warnbox warn' },
      t('review.updateFrom', { from: data.update.fromVersion || '?', to: m.version || '?' }),
      data.update.addedKeys.length ? h('div', null, t('review.addedKeys', { keys: data.update.addedKeys.join(', ') })) : null,
      data.update.removedKeys.length ? h('div', null, t('review.removedKeys', { keys: data.update.removedKeys.join(', ') })) : null) : null,
    mode === 'approve' && data.newKeys.length ? h('div', { class: 'warnbox warn' }, t('review.pendingKeys', { count: data.newKeys.length })) : null,
    ...warnings,
    h('div', { class: 'section' },
      h('div', { class: 'label' }, t('review.keys', { count: m.keys.length })),
      m.keys.length ? h('div', { class: 'keys' },
        data.risk.dangerous.map((k) => keyChip(k, true)),
        data.risk.normal.map((k) => keyChip(k, false))) : h('div', { class: 'hint small' }, t('review.noKeys'))),
    h('div', { class: 'section' },
      h('div', { class: 'label' }, t('review.apps')),
      h('div', null, m.apps && m.apps.length ? m.apps.join(', ') : t('shards.anyApp'))),
    h('div', { class: 'section' },
      h('div', { class: 'label' }, t('review.license')),
      h('div', null, m.license || t('shards.noLicense'), ' ',
        m.url ? h('button', { class: 'btn small', title: m.url, onclick: () => call(api.openShardPage, mode === 'install' ? { candidate: data.id } : { shard: m.id }) }, t('shards.page')) : null)),
    data.size ? h('div', { class: 'hint small' }, t('review.size', { files: data.size.files, size: fmtSize(data.size.bytes) })) : null,
    h('div', { class: 'buttons' },
      mode === 'view'
        ? h('button', { class: 'btn primary', onclick: closeModal }, t('action.close'))
        : [h('button', { class: 'btn', onclick: cancel }, t('action.cancel')),
          h('button', { class: 'btn primary', onclick: confirm }, mode === 'install' ? (data.link ? t('review.link') : data.update ? t('review.update') : t('review.install')) : t('review.approve'))]),
  );
  $('modal').hidden = false;
  $('modal').onclick = (e) => { if (e.target === $('modal')) cancel(); };
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('modal').hidden) $('modal').click();
});

/* ---------- Shard settings (declared in its manifest) ---------- */

function settingsEditor(shard) {
  const values = { ...shard.settings };
  const field = (item) => {
    const id = 'shard-set-' + item.id;
    const set = (v) => { values[item.id] = v; };
    if (item.type === 'toggle') {
      return h('div', { class: 'setting' },
        h('div', { class: 'grow' }, h('label', { for: id }, item.label)),
        h('label', { class: 'switch' }, h('input', { type: 'checkbox', id, checked: !!values[item.id], onchange: (e) => set(e.target.checked) }), h('span')));
    }
    let input;
    if (item.type === 'select') {
      input = h('select', { id, onchange: (e) => set(e.target.value) },
        item.options.map((o) => h('option', { value: o.value, selected: values[item.id] === o.value }, o.label)));
    } else if (item.type === 'number') {
      input = h('input', { id, type: 'number', class: 'port', value: String(values[item.id]), min: item.min, max: item.max, step: item.step,
        onchange: (e) => set(Number(e.target.value)) });
    } else if (item.type === 'color') {
      input = h('input', { id, type: 'color', value: values[item.id], onchange: (e) => set(e.target.value) });
    } else {
      input = h('input', { id, type: 'text', class: 'grow-input', value: values[item.id], maxlength: String(item.maxLength), oninput: (e) => set(e.target.value) });
    }
    return h('div', { class: 'setting' }, h('div', { class: 'grow' }, h('label', { for: id }, item.label)), input);
  };
  const save = async () => {
    const r = await call(api.setShardSettings, shard.id, values);
    if (r && r.ok) { closeModal(); toast(t('shardSettings.saved', { name: shard.name || shard.id })); }
  };
  const reset = async () => {
    const r = await call(api.resetShardSettings, shard.id);
    if (r && r.ok) { closeModal(); toast(t('shardSettings.restored', { name: shard.name || shard.id })); }
  };
  fill($('dialog'),
    h('div', { class: 'label' }, t('shardSettings.title')),
    h('h3', null, shard.name || shard.id),
    h('div', null, shard.settingsSchema.map(field)),
    h('div', { class: 'hint small' }, t('shardSettings.hint')),
    h('div', { class: 'buttons' },
      h('button', { class: 'btn', onclick: reset }, t('shardSettings.restore')),
      h('button', { class: 'btn', onclick: closeModal }, t('action.cancel')),
      h('button', { class: 'btn primary', onclick: save }, t('action.save'))));
  $('modal').hidden = false;
  $('modal').onclick = (e) => { if (e.target === $('modal')) closeModal(); };
}

/* ---------- Apps editor: where a shard may act ---------- */

const sameApp = (a, b) => (a.exe && b.exe ? a.exe.toLowerCase() === b.exe.toLowerCase() : a.match && b.match && a.match.toLowerCase() === b.match.toLowerCase());

function appRow(a, onRemove) {
  return h('div', { class: 'app-row' },
    a.icon ? h('img', { class: 'app-icon', src: a.icon, alt: '' }) : h('div', { class: 'ico small' }, (a.name || a.match || '?').charAt(0).toUpperCase()),
    h('div', { class: 'grow' },
      h('div', { class: 'name' }, a.name || a.match),
      h('div', { class: 'meta' }, a.exe ? a.exe : t('apps.textRule', { text: a.match }))),
    onRemove ? h('button', { class: 'btn small', onclick: onRemove }, t('apps.remove')) : null);
}

// Edits a copy; nothing is saved until "Save"
function appsEditor(shard) {
  const ed = {
    mode: shard.appEntries.length ? 'only' : 'any',
    apps: shard.appEntries.map((a) => ({ ...a })),
    open: null, // open apps, once listed
    counting: 0,
  };
  const add = (a) => { if (!ed.apps.some((x) => sameApp(x, a))) ed.apps.push(a); ed.mode = 'only'; draw(); };

  async function listOpen() {
    const r = await call(api.listOpenApps);
    if (r && r.ok) { ed.open = r.apps || []; draw(); }
  }
  function detect() {
    ed.counting = 5;
    draw();
    const timer = setInterval(async () => {
      ed.counting--;
      if (ed.counting > 0) return draw();
      clearInterval(timer);
      draw();
      const r = await call(api.detectApp);
      if (r && r.ok && r.app) add(r.app);
    }, 1000);
  }
  async function save() {
    const rule = ed.mode === 'any' ? { mode: 'any' } : { mode: 'only', apps: ed.apps.map(({ icon, ...a }) => a) };
    const r = await call(api.setShardApps, shard.id, rule);
    if (r && r.ok) { closeModal(); toast(t('apps.saved', { name: shard.name || shard.id })); }
  }
  async function reset() {
    const r = await call(api.resetShardApps, shard.id);
    if (r && r.ok) { closeModal(); toast(t('apps.restored', { name: shard.name || shard.id })); }
  }

  function draw() {
    const textInput = h('input', { class: 'grow-input', maxlength: '100', placeholder: t('apps.textPlaceholder') });
    const addText = () => { const v = textInput.value.trim(); if (v) add({ match: v }); };
    textInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addText(); });
    const choice = (mode, label, hint) => h('button', {
      class: 'choice' + (ed.mode === mode ? ' on' : ''), 'aria-pressed': String(ed.mode === mode),
      onclick: () => { ed.mode = mode; draw(); },
    }, h('b', null, label), h('span', null, hint));

    fill($('dialog'),
      h('div', { class: 'label' }, t('apps.title')),
      h('h3', null, shard.name || shard.id),
      h('div', { class: 'choices' },
        choice('any', t('apps.modeAny'), t('apps.modeAnyHint')),
        choice('only', t('apps.modeOnly'), t('apps.modeOnlyHint'))),
      ed.mode === 'only' ? [
        ed.apps.length
          ? h('div', { class: 'app-list' }, ed.apps.map((a) => appRow(a, () => { ed.apps = ed.apps.filter((x) => x !== a); draw(); })))
          : h('div', { class: 'warnbox warn' }, t('apps.empty')),
        h('div', { class: 'row' },
          state.detection === 'title' ? null : h('button', { class: 'btn small', onclick: listOpen }, t('apps.pickOpen')),
          h('button', { class: 'btn small', disabled: ed.counting > 0, onclick: detect },
            ed.counting > 0 ? t('apps.detecting', { seconds: ed.counting }) : t('apps.detect'))),
        ed.counting > 0 ? h('div', { class: 'hint small' }, t('apps.detectHint')) : null,
        ed.open ? h('div', { class: 'section' },
          h('div', { class: 'label' }, t('apps.openTitle')),
          ed.open.length
            ? h('div', { class: 'app-list' }, ed.open.filter((a) => !ed.apps.some((x) => sameApp(x, a))).map((a) =>
              h('div', { class: 'app-row' },
                a.icon ? h('img', { class: 'app-icon', src: a.icon, alt: '' }) : h('div', { class: 'ico small' }, a.name.charAt(0)),
                h('div', { class: 'grow' }, h('div', { class: 'name' }, a.name), h('div', { class: 'meta' }, a.exe)),
                h('button', { class: 'btn small primary', onclick: () => add(a) }, t('apps.add')))))
            : h('div', { class: 'hint small' }, t('apps.noneOpen'))) : null,
        h('div', { class: 'section' },
          h('div', { class: 'label' }, t('apps.textTitle')),
          h('div', { class: 'row' }, textInput, h('button', { class: 'btn small', onclick: addText }, t('apps.add'))),
          h('div', { class: 'hint small' }, state.detection === 'title' ? t('apps.titleOnly') : t('apps.textHint'))),
      ] : null,
      shard.suggestedApps.length ? h('div', { class: 'hint small' },
        t('apps.suggested', { apps: shard.suggestedApps.map((a) => a.name || a.exe || a.match).join(', ') })) : null,
      h('div', { class: 'buttons' },
        shard.customApps ? h('button', { class: 'btn', onclick: reset }, t('apps.restore')) : null,
        h('button', { class: 'btn', onclick: closeModal }, t('action.cancel')),
        h('button', { class: 'btn primary', disabled: ed.mode === 'only' && !ed.apps.length, onclick: save }, t('action.save'))),
    );
  }

  draw();
  $('modal').hidden = false;
  $('modal').onclick = (e) => { if (e.target === $('modal')) closeModal(); };
}

/* ---------- Settings ---------- */

function toggle(key, label, hint) {
  return h('div', { class: 'setting' },
    h('div', { class: 'grow' }, h('label', { for: 'set-' + key }, label), hint ? h('div', { class: 'hint small' }, hint) : null),
    h('label', { class: 'switch' },
      h('input', { type: 'checkbox', id: 'set-' + key, checked: !!state.settings[key], onchange: (e) => call(api.setSetting, key, e.target.checked) }),
      h('span')));
}

function renderSettings() {
  const p = $('tab-settings');
  const portInput = h('input', { class: 'port', type: 'number', min: '1024', max: '65535', value: String(state.settings.port) });
  fill(p,
    h('div', { class: 'setting' },
      h('div', { class: 'grow' },
        h('label', { for: 'set-language' }, t('settings.language')),
        // Languages translated by AI say so, with a way to propose a fix
        state.machineTranslated ? h('div', { class: 'hint small' }, t('settings.languageMachine')) : null,
        state.machineTranslated ? h('button', { class: 'btn small', onclick: () => call(api.openLink, 'translation') }, t('settings.languageFix')) : null),
      h('select', { id: 'set-language', onchange: (e) => call(api.setSetting, 'language', e.target.value) },
        ['auto', ...state.languages].map((l) => h('option', { value: l, selected: state.settings.language === l }, t('settings.language.' + l))))),
    h('div', { class: 'setting' },
      h('div', { class: 'grow' }, h('label', null, t('settings.port')), h('div', { class: 'hint small' }, t('settings.portHint'))),
      portInput,
      h('button', { class: 'btn small', onclick: () => call(api.setSetting, 'port', Number(portInput.value)) }, t('action.save'))),
    toggle('confirmDevices', t('settings.confirmDevices'), t('settings.confirmDevicesHint')),
    toggle('closeToTray', t('settings.closeToTray'), t('settings.closeToTrayHint')),
    toggle('openAtLogin', t('settings.openAtLogin'), t('settings.openAtLoginHint')),
    toggle('allowAppsFromTablet', t('settings.allowAppsFromTablet'), t('settings.allowAppsFromTabletHint')),
    // On Linux the panel always stays on top (see openPanel in main.js), so the choice is hidden
    state.platform === 'linux' ? null : toggle('panelAlwaysOnTop', t('settings.panelAlwaysOnTop'), t('settings.panelAlwaysOnTopHint')),
    toggle('allowPublicNetworks', t('settings.publicNetworks'), t('settings.publicNetworksHint')),
    h('h2', null, t('settings.folders')),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: () => api.openPath('shards') }, t('shards.openShardsFolder')),
      h('button', { class: 'btn small', onclick: () => api.openPath('data') }, t('settings.openData'))),
    h('h2', null, t('backup.title')),
    h('p', { class: 'hint small' }, t('backup.hint')),
    h('div', { class: 'row' },
      h('button', { class: 'btn small', onclick: exportBackup }, t('backup.export')),
      h('button', { class: 'btn small', onclick: importBackup }, t('backup.import'))),
    renderAbout(),
  );
}

/* ---------- Backups ---------- */

async function exportBackup() {
  const r = await call(api.exportBackup);
  if (r && r.ok && r.saved) toast(t('backup.saved'));
}

// Settings that change who can reach this PC or what tablets may do: flagged in the summary
const SECURITY_SETTINGS = ['port', 'allowPublicNetworks', 'confirmDevices', 'allowAppsFromTablet'];
const settingLabel = (key) => t({ allowPublicNetworks: 'settings.publicNetworks' }[key] || 'settings.' + key);
function settingValue(key, v) {
  if (typeof v === 'boolean') return v ? t('backup.on') : t('backup.off');
  if (key === 'language') return t('settings.language.' + v);
  return String(v);
}

// Reads a backup and shows what importing it would change; nothing is applied before "Import"
async function importBackup() {
  const r = await call(api.pickBackup);
  if (!r || !r.ok || !r.summary) return;
  const s = r.summary;
  const name = (id) => (state.shards.find((x) => x.id === id) || {}).name || id;
  const cancel = () => { api.cancelBackup(s.id); closeModal(); };
  const apply = async () => {
    closeModal();
    const res = await call(api.applyBackup, s.id);
    if (res && res.ok && !s.install.length) toast(t('backup.done'));
  };
  const risky = s.settings.some((x) => SECURITY_SETTINGS.includes(x.key));
  const nothing = !s.settings.length && !s.rules && !s.install.length && !s.states;
  fill($('dialog'),
    h('div', { class: 'label' }, t('backup.summaryTitle')),
    h('div', { class: 'meta' }, t('backup.from', { version: s.appVersion || '?', date: s.createdAt ? fmtDate(s.createdAt) : '?' })),
    nothing ? h('div', { class: 'hint small' }, t('backup.nothing')) : null,
    s.settings.length ? h('div', { class: 'section' },
      h('div', { class: 'label' }, t('backup.settings', { count: s.settings.length })),
      risky ? h('div', { class: 'warnbox warn' }, t('backup.securityNote')) : null,
      s.settings.map((x) => h('div', { class: SECURITY_SETTINGS.includes(x.key) ? 'backup-change risky' : 'backup-change' },
        settingLabel(x.key) + ': ' + settingValue(x.key, x.from) + ' → ' + settingValue(x.key, x.to)))) : null,
    s.rules ? h('div', { class: 'hint small' }, t('backup.rules', { count: s.rules })) : null,
    s.states ? h('div', { class: 'hint small' }, t('backup.states', { count: s.states })) : null,
    s.install.length ? h('div', { class: 'section' },
      h('div', { class: 'label' }, t('backup.install', { count: s.install.length })),
      h('div', { class: 'hint small' }, t('backup.installHint')),
      h('div', null, s.install.join(', '))) : null,
    s.kept.length ? h('div', { class: 'hint small' }, t('backup.kept', { names: s.kept.map(name).join(', ') })) : null,
    h('div', { class: 'hint small' }, t('backup.never')),
    h('div', { class: 'buttons' },
      h('button', { class: 'btn', onclick: cancel }, t('action.cancel')),
      h('button', { class: 'btn primary', disabled: nothing, onclick: apply }, t('backup.apply'))),
  );
  $('modal').hidden = false;
  $('modal').onclick = (e) => { if (e.target === $('modal')) cancel(); };
}
api.onBackupDone(() => toast(t('backup.done')));

// What the last check for a new version found
function updateStatus() {
  const u = state.update;
  if (u.checking) return t('about.updateChecking');
  if (u.failed) return t('about.updateFailed');
  if (u.latest && u.newer) return t('update.available', { version: u.latest });
  if (u.latest) return t('about.updateLatest');
  return state.settings.checkUpdates ? t('about.updatePending') : t('about.updateOff');
}

// Version, links and what helps with a bug report. Links name a destination; main.js holds the URLs.
function renderAbout() {
  const link = (kind, label) => h('button', { class: 'btn small', onclick: () => call(api.openLink, kind) }, label);
  const copy = async () => { if ((await call(api.copyDiagnostics))?.ok !== false) toast(t('about.copied')); };
  const report = async () => { if ((await call(api.reportBug))?.ok !== false) toast(t('about.reportOpened')); };
  return [
    h('h2', null, t('about.title')),
    h('p', { class: 'about-version' }, t('about.version', { version: state.version })),
    h('p', { class: 'hint small' }, t('about.license')),
    h('div', { class: 'row' },
      link('website', t('about.website')),
      link('source', t('about.source')),
      link('security', t('about.security')),
      link('license', t('about.licenseLink')),
      state.thirdPartyLicenses ? h('button', { class: 'btn small', onclick: () => api.openPath('licenses') }, t('about.thirdParty')) : null),
    h('h2', null, t('about.supportTitle')),
    h('p', { class: 'hint small' }, t('about.supportHint')),
    h('div', { class: 'row' }, h('button', { class: 'btn small primary', onclick: () => call(api.openLink, 'donate') }, t('about.supportButton'))),
    h('h2', null, t('about.updates')),
    toggle('checkUpdates', t('settings.checkUpdates'), t('settings.checkUpdatesHint')),
    h('div', { class: 'row update-status' },
      h('span', { class: 'hint small grow' }, updateStatus()),
      state.update.latest && state.update.newer ? h('button', { class: 'btn small primary', onclick: () => call(api.openLink, 'download') }, t('update.download')) : null,
      h('button', { class: 'btn small', disabled: state.update.checking, onclick: () => call(api.checkUpdates) }, t('about.checkNow'))),
    h('h2', null, t('about.problems')),
    h('p', { class: 'hint small' }, t('about.problemsHint')),
    h('div', { class: 'row' },
      h('button', { class: 'btn small primary', onclick: report }, t('about.report')),
      h('button', { class: 'btn small', onclick: copy }, t('about.copy')),
      h('button', { class: 'btn small', onclick: () => api.openPath('logs') }, t('about.openLogs'))),
  ];
}

/* ---------- Drag and drop ---------- */

let dragDepth = 0;
document.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; $('drop').hidden = false; });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('drop').hidden = true; } });
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  $('drop').hidden = true;
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const p = api.pathForFile(file);
  if (/\.streamdeckprofile$/i.test(p)) { await call(api.importStreamDeck, p); return; }
  const r = await call(api.prepareInstall, p);
  if (r && r.ok && r.review) review(r.review, 'install');
});

/* ---------- Startup ---------- */

function render() {
  renderChrome();
  if (tab === 'connect') renderConnect();
  if (tab === 'devices') renderDevices();
  if (tab === 'shards') renderShards();
  if (tab === 'settings') renderSettings();
}

for (const b of document.querySelectorAll('.tab')) {
  b.addEventListener('click', () => { tab = b.dataset.tab; render(); });
}
$('pause').addEventListener('click', () => call(api.setPaused, !state.paused));
$('restartBtn').addEventListener('click', () => api.restart());
$('updateDownload').addEventListener('click', () => call(api.openLink, 'download'));
$('updateDismiss').addEventListener('click', () => call(api.dismissUpdate));
$('supportYes').addEventListener('click', () => { call(api.openLink, 'donate'); call(api.supportDone, true); });
$('supportNo').addEventListener('click', () => call(api.supportDone, false));

function apply(s) {
  state = s;
  clockOffset = s.now - Date.now();
  document.documentElement.lang = s.locale;
  // Don't rebuild a panel while the user is typing in it (renaming a device, for example)
  const typing = document.activeElement && document.activeElement.matches('input:not([type="checkbox"]), select');
  if (typing) renderChrome(); else render();
}

api.onState(apply);
api.onReview((r) => { tab = 'shards'; render(); review(r, 'install'); });
api.getState().then(apply);
