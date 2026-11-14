// Panels: shards made with the editor, without code. panel.json holds the layout (the editor's
// source); everything else in the folder is generated from it and from the panel template.
//
// validatePanel() cleans a parsed panel.json the way validateManifest() cleans a manifest: only
// known fields survive, texts are trimmed, colors and keys are checked. Problems with one button or
// one style value drop just that (listed in `warnings`); problems with the panel as a whole make it
// invalid (`errors`). The editor's own output never has warnings, so saving treats them as errors.
const crypto = require('crypto');
const { parse, normalize } = require('./keys');

const FORMAT = 1;
const MIN_APP_VERSION = '0.4.0';
const LIMITS = { grid: 24, pages: 50, text: 60, note: 120, keys: 300, repeat: [50, 1000] };

const TYPES = ['press', 'hold', 'repeat', 'toggle', 'page', 'label', 'none'];
const KEYED = new Set(['press', 'hold', 'repeat']);
const PAGE_TARGETS = ['back', 'next', 'prev'];
const LABEL_POS = ['top', 'middle', 'bottom'];
const SIZES = ['s', 'm', 'l'];
const THEMES = ['libreshard', 'light', 'contrast', 'oled', 'keys'];
const SPACING = ['compact', 'normal', 'wide'];
const FONTS = ['system', 'mono', 'serif'];
const FILLS = ['flat', 'gradient', 'none'];
const IMAGE_FITS = ['inset', 'bleed'];

const ID = /^[A-Za-z0-9_-]{1,32}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
// Images are always re-encoded by the app and named after their hash, so only that shape is valid
const IMAGE = /^images\/[a-z0-9-]{1,40}\.png$/;

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const oneOf = (list, v) => (list.includes(v) ? v : undefined);
const color = (v) => (typeof v === 'string' && COLOR.test(v) ? v.toLowerCase() : undefined);
const intIn = (v, min, max) => (Number.isInteger(v) && v >= min && v <= max ? v : undefined);

// Texts keep line breaks (titles use them to place the text) but no other control characters
function text(v, max = LIMITS.text) {
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim();
  return s ? [...s].slice(0, max).join('') : undefined;
}

// At most two graphemes ("👍🏽" is one, a flag is one)
function emoji(v) {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const parts = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(v.trim())].map((s) => s.segment);
  return parts.slice(0, 2).join('').slice(0, 32);
}

// A normalized combo that keys.js can press, or undefined
function key(v) {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const k = normalize(v);
  try { parse(k); return k; } catch { return undefined; }
}

// Drops undefined fields so the cleaned panel round-trips to the same JSON
function compact(o) {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
}

function cleanImage(file, files) {
  if (typeof file !== 'string' || !IMAGE.test(file)) return undefined;
  if (files && !files.has(file)) return undefined;
  return file;
}

function cleanIcon(raw, files) {
  if (!isObject(raw)) return undefined;
  if (raw.kind === 'builtin') return typeof raw.name === 'string' && /^[a-z0-9-]{1,40}$/.test(raw.name) ? { kind: 'builtin', name: raw.name } : undefined;
  if (raw.kind === 'emoji') { const t = emoji(raw.text); return t ? { kind: 'emoji', text: t } : undefined; }
  if (raw.kind === 'image') {
    const file = cleanImage(raw.file, files);
    if (!file) return undefined;
    return compact({ kind: 'image', file, imported: raw.imported === 'streamdeck' ? 'streamdeck' : undefined });
  }
  return undefined;
}

// What a button looks like (shared by a button and the second state of a toggle)
function cleanLook(raw, files) {
  return {
    label: text(raw.label),
    icon: cleanIcon(raw.icon, files),
    color: color(raw.color),
    textColor: color(raw.textColor),
  };
}

function cleanStyle(raw, files, warn) {
  if (raw === undefined) return undefined;
  if (!isObject(raw)) { warn('"style" must be an object'); return undefined; }
  // Each value is checked on its own: a bad one is dropped with a warning, the rest stay
  const pick = (where, value, cleaned) => {
    if (value === undefined) return undefined;
    if (cleaned === undefined) warn(`style: invalid ${where}`);
    return cleaned;
  };
  const out = { theme: pick('theme', raw.theme, oneOf(THEMES, raw.theme)) };

  if (raw.background !== undefined) {
    const b = raw.background;
    let bg;
    if (isObject(b) && b.kind === 'color' && color(b.color)) bg = { kind: 'color', color: color(b.color) };
    else if (isObject(b) && b.kind === 'gradient' && Array.isArray(b.colors) && b.colors.length === 2 && b.colors.every(color)) {
      bg = { kind: 'gradient', colors: b.colors.map(color) };
    } else if (isObject(b) && b.kind === 'image' && cleanImage(b.file, files)) {
      bg = compact({ kind: 'image', file: b.file, dim: pick('background dim', b.dim, intIn(b.dim, 0, 80)) });
    }
    out.background = pick('background', b, bg);
  }

  if (raw.button !== undefined) {
    const b = raw.button;
    if (!isObject(b)) warn('style: invalid button');
    else {
      const btn = compact({
        radius: pick('button radius', b.radius, intIn(b.radius, 0, 40)),
        border: pick('button border', b.border, intIn(b.border, 0, 4)),
        borderColor: pick('button borderColor', b.borderColor, color(b.borderColor)),
        fill: pick('button fill', b.fill, oneOf(FILLS, b.fill)),
        shadow: pick('button shadow', b.shadow, typeof b.shadow === 'boolean' ? b.shadow : undefined),
        color: pick('button color', b.color, color(b.color)),
        activeColor: pick('button activeColor', b.activeColor, color(b.activeColor)),
        imageFit: pick('button imageFit', b.imageFit, oneOf(IMAGE_FITS, b.imageFit)),
      });
      if (Object.keys(btn).length) out.button = btn;
    }
  }

  out.spacing = pick('spacing', raw.spacing, oneOf(SPACING, raw.spacing));

  if (raw.text !== undefined) {
    const t = raw.text;
    if (!isObject(t)) warn('style: invalid text');
    else {
      const txt = compact({
        color: pick('text color', t.color, color(t.color)),
        size: pick('text size', t.size, oneOf(SIZES, t.size)),
        font: pick('text font', t.font, oneOf(FONTS, t.font)),
      });
      if (Object.keys(txt).length) out.text = txt;
    }
  }
  compact(out);
  return Object.keys(out).length ? out : undefined;
}

// Cleans one button. Returns null to drop it (with a warning); an action that can't work (unknown
// key, missing page) turns the button into "none", which keeps its text and image.
function cleanButton(raw, ctx) {
  const { grid, files, warn, where } = ctx;
  if (!isObject(raw)) { warn(`${where}: not an object`); return null; }
  const col = intIn(raw.col, 0, grid.cols - 1);
  const row = intIn(raw.row, 0, grid.rows - 1);
  if (col === undefined || row === undefined) { warn(`${where}: outside the grid`); return null; }
  const w = raw.w === undefined ? 1 : intIn(raw.w, 1, grid.cols - col);
  const h = raw.h === undefined ? 1 : intIn(raw.h, 1, grid.rows - row);
  if (w === undefined || h === undefined) { warn(`${where}: size goes outside the grid`); return null; }

  let type = oneOf(TYPES, raw.type);
  if (!type) { warn(`${where}: unknown type`); type = 'none'; }
  const b = { id: raw.id, col, row, w, h, type };

  if (KEYED.has(type)) {
    b.key = key(raw.key);
    if (!b.key) { warn(`${where}: unknown key`); b.type = 'none'; delete b.key; }
    else if (type === 'repeat') b.repeat = intIn(raw.repeat, ...LIMITS.repeat) ?? 100;
  } else if (type === 'toggle') {
    const keys = Array.isArray(raw.keys) && raw.keys.length === 2 ? raw.keys.map(key) : [];
    if (keys.length !== 2 || keys.some((k) => !k)) { warn(`${where}: a toggle needs two known keys`); b.type = 'none'; }
    else b.keys = keys;
  } else if (type === 'page') {
    if (PAGE_TARGETS.includes(raw.page) || (typeof raw.page === 'string' && ctx.pageIds.has(raw.page))) b.page = raw.page;
    else { warn(`${where}: the page it opens doesn't exist`); b.type = 'none'; }
  }

  Object.assign(b, cleanLook(raw, files));
  b.labelPos = oneOf(LABEL_POS, raw.labelPos);
  b.labelSize = oneOf(SIZES, raw.labelSize);
  b.note = text(raw.note, LIMITS.note);
  if (b.type === 'toggle' && isObject(raw.alt)) {
    const alt = compact(cleanLook(raw.alt, files));
    if (Object.keys(alt).length) b.alt = alt;
  }
  return compact(b);
}

// Checks a parsed panel.json. `files` (a Set of "images/…" paths present in the folder) makes
// missing images count as invalid; without it only their names are checked.
// Returns { ok, errors, warnings, panel }.
function validatePanel(raw, { files } = {}) {
  const errors = [];
  const warnings = [];
  const warn = (m) => warnings.push(m);
  const fail = (m) => ({ ok: false, errors: [m], warnings, panel: null });
  if (!isObject(raw)) return fail('panel.json must be a JSON object');
  if (raw.format !== FORMAT) return fail(raw.format > FORMAT ? 'this panel needs a newer version of LibreShard' : '"format" must be 1');

  const cols = intIn(raw.grid?.cols, 1, LIMITS.grid);
  const rows = intIn(raw.grid?.rows, 1, LIMITS.grid);
  if (!cols || !rows) return fail(`"grid" must have "cols" and "rows" from 1 to ${LIMITS.grid}`);
  const grid = { cols, rows };

  if (!Array.isArray(raw.pages) || raw.pages.length === 0) return fail('"pages" must be a non-empty list');
  if (raw.pages.length > LIMITS.pages) return fail(`more than ${LIMITS.pages} pages`);

  // Page ids first: buttons may open any page, including later ones
  const pageIds = new Set();
  for (const [n, p] of raw.pages.entries()) {
    if (!isObject(p)) return fail(`page ${n + 1} is not an object`);
    if ((p.layout ?? 'grid') !== 'grid') return fail('this panel needs a newer version of LibreShard (unknown page layout)');
    if (typeof p.id !== 'string' || !ID.test(p.id) || pageIds.has(p.id)) return fail(`page ${n + 1} needs a unique "id" (letters, digits, - and _)`);
    pageIds.add(p.id);
  }

  const buttonIds = new Set();
  const usedIds = new Set();
  for (const p of raw.pages) for (const b of Array.isArray(p.buttons) ? p.buttons : []) if (isObject(b) && typeof b.id === 'string') usedIds.add(b.id);
  let next = 1;
  const freshId = () => { while (usedIds.has('b' + next) || buttonIds.has('b' + next)) next++; return 'b' + next++; };

  const pages = raw.pages.map((p, n) => {
    const page = { id: p.id, name: text(p.name) || `${n + 1}`, layout: 'grid', buttons: [] };
    if (p.buttons !== undefined && !Array.isArray(p.buttons)) warn(`page "${p.id}": "buttons" must be a list`);
    const taken = new Set();
    for (const [i, rb] of (Array.isArray(p.buttons) ? p.buttons : []).entries()) {
      const where = `page "${p.id}", button ${i + 1}`;
      const b = cleanButton(rb, { grid, files, warn, where, pageIds });
      if (!b) continue;
      const cells = [];
      for (let c = b.col; c < b.col + b.w; c++) for (let r = b.row; r < b.row + b.h; r++) cells.push(c + ',' + r);
      if (cells.some((c) => taken.has(c))) { warn(`${where}: overlaps another button`); continue; }
      cells.forEach((c) => taken.add(c));
      // Ids are kept when valid and unique across the panel (a toggle's state is saved by id)
      if (typeof b.id !== 'string' || !ID.test(b.id) || buttonIds.has(b.id)) b.id = freshId();
      buttonIds.add(b.id);
      page.buttons.push(b);
    }
    return page;
  });

  const panel = compact({
    format: FORMAT,
    grid,
    pageBar: typeof raw.pageBar === 'boolean' ? raw.pageBar : undefined,
    style: cleanStyle(raw.style, files, warn),
    pages,
  });
  const keys = keysOf(panel);
  if (keys.length > LIMITS.keys) errors.push(`the panel uses ${keys.length} different keys; the limit is ${LIMITS.keys}`);
  return { ok: errors.length === 0, errors, warnings, panel: errors.length ? null : panel };
}

// Every key a (validated) panel can press, without repeats: its manifest's permissions.keys
function keysOf(panel) {
  const keys = new Set();
  for (const p of panel.pages) {
    for (const b of p.buttons) {
      if (b.key) keys.add(b.key);
      if (b.keys) b.keys.forEach((k) => keys.add(k));
    }
  }
  return [...keys];
}

// Every image a panel uses (buttons, toggle second states and the background)
function imagesOf(panel) {
  const files = new Set();
  const icon = (i) => { if (i?.kind === 'image') files.add(i.file); };
  for (const p of panel.pages) for (const b of p.buttons) { icon(b.icon); icon(b.alt?.icon); }
  if (panel.style?.background?.kind === 'image') files.add(panel.style.background.file);
  return [...files];
}

// "Diseño de sonido" → "panel-diseno-de-sonido-3fa9"; never longer than 64 characters
function panelId(name, random = crypto.randomBytes(2).toString('hex')) {
  const slug = String(name || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64 - 'panel--'.length - random.length).replace(/-+$/, '');
  return `panel-${slug || 'panel'}-${random}`;
}

// "1.0.4" → "1.0.5"; anything else starts at "1.0.0"
function nextVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
  return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : '1.0.0';
}

// JSON that can sit inside a <script> and a JS string: no "</script>", no line separators
const scriptJson = (v) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

// The files of a panel's shard folder, except its images: manifest.json, panel.json and layout.js,
// plus the template files (index.html, libreshard.css, …) given as { name: content }.
// `meta` is what the manifest says besides keys: { id?, name, icon, description, author, apps,
// version }. Without an id it's a new panel; the version goes up on every save.
function buildShard({ panel, meta = {}, template = {} }) {
  const manifest = compact({
    id: meta.id || panelId(meta.name),
    name: text(meta.name) || 'Panel',
    author: text(meta.author),
    version: meta.id ? nextVersion(meta.version) : '1.0.0',
    icon: typeof meta.icon === 'string' && meta.icon.trim() ? meta.icon.trim().slice(0, 16) : undefined,
    description: text(meta.description, 300),
    minAppVersion: MIN_APP_VERSION,
    apps: Array.isArray(meta.apps) && meta.apps.length ? meta.apps : undefined,
    permissions: { keys: keysOf(panel) },
  });
  const layout = '// Generated by LibreShard from panel.json: edit the panel in the editor instead.\n' +
    `window.LS_PANEL = ${scriptJson(panel)};\nwindow.LS_PANEL_NAME = ${scriptJson(manifest.name)};\n`;
  return {
    manifest,
    files: {
      ...template,
      'manifest.json': JSON.stringify(manifest, null, 2) + '\n',
      'panel.json': JSON.stringify(panel, null, 2) + '\n',
      'layout.js': layout,
    },
  };
}

module.exports = { validatePanel, keysOf, imagesOf, buildShard, panelId, nextVersion, FORMAT, LIMITS, MIN_APP_VERSION };
