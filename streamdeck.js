// Stream Deck profiles (.streamDeckProfile) as panels, without Electron. The profile stays on this
// PC: it's read once, turned into a panel the editor opens unsaved, and its folder removed.
//
// A profile is a zip, in one of two layouts (docs/plans/paneles-sin-programar.md, section 0):
// - format 3.0 (app 7.x): package.json at the root and Profiles/<UUID>.sdProfile/, with one folder
//   per page named after its UUID in capitals;
// - format 2.0 (app 6.x): <UUID>.sdProfile/ at the root, page folders named after their UUID in
//   base32 (alphabet without U) plus "Z".
// The profile's manifest lists its pages in order (Pages.Pages); folders are pages reached through
// an "openchild" button. Each page has Controllers [{ Type: "Keypad", Actions: { "col,row": action } }].
//
// convert() returns the panel with image icons pointing at "src:<n>", n being an index into
// `images` (absolute paths of the profile's PNGs): the main process re-encodes them, and
// resolveImages() puts their final names in.
const fs = require('fs');
const path = require('path');
const { entryToCombo, realEntries, sourceSystem } = require('./streamdeck-keys');
const { LIMITS } = require('./panel-format');

const SD = 'com.elgato.streamdeck.';
const MAX_JSON = 2 * 1024 * 1024;
const MAX_IMAGE = 4 * 1024 * 1024;

// Grids of the models whose code is known (the "20G…" profile code shares its letters with the
// product number). Only 20GAA was checked with an export (2026-11-14); a profile whose buttons go
// further than its model's grid gets a bigger one. Virtual devices ("VSD2/…") don't say their size.
const MODELS = { '20GAA': [5, 3], '20GBA': [5, 3], '20GAI': [3, 2], '20GAT': [8, 4], '20GBD': [4, 2], '20GBJ': [4, 2] };

const MULTIMEDIA = { 0: 'prev', 1: 'playpause', 2: 'next', 4: 'mute', 5: 'volup', 6: 'voldown' };

// Why a button was left without an action, and why one should be checked (the strings
// import.reason.<code> and import.short.<code> say it to the user)
const REASONS = {
  none: ['noKey', 'sequence', 'unsupportedKey', 'stop', 'pageIndicator', 'keyLogicEmpty', 'text', 'open', 'website',
    'multiaction', 'plugin', 'other', 'missingPage', 'tooManyPages'],
  check: ['mac', 'keyLogic', 'review'],
  uncounted: ['outside'], // positions past the largest grid: no button to put a note on
};

class ProfileError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function readJson(file) {
  let st;
  try { st = fs.lstatSync(file); } catch { return undefined; }
  if (!st.isFile() || st.size > MAX_JSON) return undefined;
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { return undefined; }
}

const listDir = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } };

// Format 2.0 folder names: the UUID's 16 bytes in base32 (most significant bit first), then "Z"
const B32 = '0123456789ABCDEFGHIJKLMNOPQRSTVW';
function base32Uuid(name) {
  const s = name.toUpperCase().replace(/Z$/, '');
  if (s.length !== 26 || [...s].some((c) => !B32.includes(c))) return undefined;
  let bits = '';
  for (const c of s) bits += B32.indexOf(c).toString(2).padStart(5, '0');
  const hex = BigInt('0b' + bits.slice(0, 128)).toString(16).padStart(32, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// Finds the profile in an extracted folder: { format, base, pkg }
function locate(dir) {
  const pkg = readJson(path.join(dir, 'package.json'));
  const inProfiles = listDir(path.join(dir, 'Profiles')).find((d) => d.isDirectory() && /\.sdProfile$/i.test(d.name));
  if (inProfiles) return { format: 3, base: path.join(dir, 'Profiles', inProfiles.name), pkg: isObject(pkg) ? pkg : {} };
  const atRoot = listDir(dir).find((d) => d.isDirectory() && /\.sdProfile$/i.test(d.name));
  if (atRoot) return { format: 2, base: path.join(dir, atRoot.name), pkg: {} };
  // Stream Deck 4.x put the actions in the profile's own manifest: not supported
  if (listDir(dir).some((d) => d.isFile() && d.name === 'manifest.json')) throw new ProfileError('oldFormat');
  throw new ProfileError('notProfile');
}

// UUID (lowercase) → page folder
function pageFolders(base) {
  const map = new Map();
  for (const d of listDir(path.join(base, 'Profiles'))) {
    if (!d.isDirectory()) continue;
    const uuid = /^[0-9a-f-]{36}$/i.test(d.name) ? d.name.toLowerCase() : base32Uuid(d.name);
    if (uuid) map.set(uuid, path.join(base, 'Profiles', d.name));
  }
  return map;
}

function gridFor(model, used) {
  const known = MODELS[String(model || '').slice(0, 5).toUpperCase()];
  const cols = Math.max(known ? known[0] : 1, used.cols);
  const rows = Math.max(known ? known[1] : 1, used.rows);
  return { cols: Math.min(cols, LIMITS.grid), rows: Math.min(rows, LIMITS.grid) };
}

// "notepad++.exe" from "C:\Program Files\Notepad++\notepad++.exe"; "Affinity Photo" from
// "/Applications/Affinity Photo.app"; nothing for "*". The user can change it on the shard's card.
function appsFor(appIdentifier) {
  const a = String(appIdentifier || '').trim();
  if (!a || a === '*') return [];
  const base = a.split(/[\\/]/).pop().replace(/\.(exe|app)$/i, '');
  return base ? [base.toLowerCase().slice(0, 100)] : [];
}

// What a button does: { type, key?, keys?, page?, reason?, detail?, adapted?, review? }
function convertAction(a, ctx) {
  const uuid = typeof a?.UUID === 'string' ? a.UUID : '';
  const s = isObject(a?.Settings) ? a.Settings : {};
  const none = (reason, detail) => ({ type: 'none', reason, ...(detail ? { detail: String(detail).slice(0, 60) } : {}) });
  const keyOf = (e) => entryToCombo(e, ctx.keys);
  const pressOf = (c) => ({ type: 'press', key: c.combo, ...(c.adapted ? { adapted: c.adapted } : {}), ...(c.review ? { review: true } : {}) });

  switch (uuid) {
    case SD + 'system.hotkey': {
      const entries = realEntries(s.Hotkeys);
      if (!entries.length) return none('noKey');
      if (entries.length > 1) return none('sequence');
      const c = keyOf(entries[0]);
      return c.unsupported ? none('unsupportedKey', c.unsupported) : pressOf(c);
    }
    case SD + 'system.hotkeyswitch': {
      const list = Array.isArray(s.Hotkeys) ? s.Hotkeys : [];
      const [c0, c1] = [keyOf(list[0]), keyOf(list[1])];
      const bad = [c0, c1].find((c) => c && c.unsupported);
      if (bad) return none('unsupportedKey', bad.unsupported);
      if (!c0 && !c1) return none('noKey');
      if (!c0 || !c1 || c0.combo === c1.combo) return pressOf(c0 || c1);
      return {
        type: 'toggle', keys: [c0.combo, c1.combo],
        ...(c0.adapted || c1.adapted ? { adapted: 'mac' } : {}), ...(c0.review || c1.review ? { review: true } : {}),
      };
    }
    case SD + 'system.multimedia': {
      const idx = s.actionIdx === undefined ? 1 : s.actionIdx; // without a value it's the first option shown
      if (idx === 3) return none('stop');
      return MULTIMEDIA[idx] ? { type: 'press', key: MULTIMEDIA[idx] } : none('other', a.Name);
    }
    case SD + 'profile.openchild': {
      const target = ctx.folder(s.ProfileUUID, a);
      return target.id ? { type: 'page', page: target.id } : none(target.reason);
    }
    case SD + 'profile.backtoparent': return { type: 'page', page: 'back' };
    case SD + 'page.next': return { type: 'page', page: 'next' };
    case SD + 'page.previous': return { type: 'page', page: 'prev' };
    case SD + 'page.indicator': return none('pageIndicator');
    case SD + 'keys.logic': return keyLogic(a, ctx);
    case SD + 'system.text': return none('text');
    case SD + 'system.open': return none('open');
    case SD + 'system.website': return none('website');
    default:
      if (uuid.startsWith(SD + 'multiactions.')) return none('multiaction');
      if (uuid.startsWith(SD)) return none('other', a.Name);
      return none('plugin', a.Plugin?.Name || a.Name || uuid);
  }
}

// "Key Logic": three slots (single press, double press, long press), each an action or
// { Actions: [...] }. The single press is imported; the other two are mentioned.
function keyLogic(a, ctx) {
  const slots = Array.isArray(a.Actions) ? a.Actions : [];
  const unwrap = (slot) => {
    if (!isObject(slot)) return [];
    if (typeof slot.UUID === 'string') return [slot];
    return Array.isArray(slot.Actions) ? slot.Actions.filter(isObject) : [];
  };
  const single = unwrap(slots[0]);
  const extra = slots.slice(1).some((slot) => unwrap(slot).length);
  if (single.length !== 1) return { type: 'none', reason: single.length ? 'multiaction' : 'keyLogicEmpty' };
  const r = convertAction(single[0], ctx);
  if (r.type === 'none' || !extra) return r;
  return { ...r, adapted: r.adapted || 'keyLogic' };
}

// The look of one state: label, its place, size and color, and its image
function lookOf(state, ctx, pageDir) {
  const st = isObject(state) ? state : {};
  const look = {};
  if (st.ShowTitle !== false && typeof st.Title === 'string' && st.Title.trim()) {
    look.label = st.Title;
    look.labelPos = ['top', 'middle', 'bottom'].includes(st.TitleAlignment) ? st.TitleAlignment : 'bottom';
    const size = Number(st.FontSize);
    if (size && size <= 10) look.labelSize = 's';
    else if (size >= 15) look.labelSize = 'l';
    const color = typeof st.TitleColor === 'string' ? st.TitleColor.toLowerCase() : '';
    if (/^#[0-9a-f]{6}$/.test(color) && color !== '#ffffff') look.textColor = color;
  }
  const src = imagePath(st.Image, pageDir);
  if (src) look.icon = { kind: 'image', file: 'src:' + ctx.image(src), imported: 'streamdeck' };
  return look;
}

// A state's image, only if it's a plain file inside the page's folder
function imagePath(rel, pageDir) {
  if (typeof rel !== 'string' || !rel || path.isAbsolute(rel)) return undefined;
  const full = path.resolve(pageDir, rel);
  if (!full.startsWith(pageDir + path.sep)) return undefined;
  try {
    const st = fs.lstatSync(full);
    return st.isFile() && st.size > 0 && st.size <= MAX_IMAGE ? full : undefined;
  } catch { return undefined; }
}

// An extracted profile as a panel. `target` is the system it will run on (process.platform).
// Returns { format, source, name, apps, model, panel, images, report, marks }, or throws a ProfileError.
function convert(dir, { target = process.platform } = {}) {
  const { base, pkg, format } = locate(dir);
  const top = readJson(path.join(base, 'manifest.json'));
  if (!isObject(top) || !isObject(top.Pages)) throw new ProfileError('invalid');
  const folders = pageFolders(base);
  const model = pkg.DeviceModel || top.Device?.Model || '';
  const keys = { source: sourceSystem({ osType: pkg.OSType, appIdentifier: top.AppIdentifier }), target };

  // Pages in order, then the Default page if it has buttons, then folders as they're found
  const order = (Array.isArray(top.Pages.Pages) ? top.Pages.Pages : []).filter((u) => typeof u === 'string').map((u) => u.toLowerCase());
  const def = typeof top.Pages.Default === 'string' ? top.Pages.Default.toLowerCase() : null;
  if (def && !order.includes(def)) order.unshift(def);
  const report = { buttons: 0, imported: 0, notImported: {}, adapted: {}, review: 0, dials: 0, pages: 0, missingPages: 0 };
  const manifests = new Map(); // uuid → page manifest
  const readPage = (uuid) => {
    if (!manifests.has(uuid)) {
      const m = folders.has(uuid) ? readJson(path.join(folders.get(uuid), 'manifest.json')) : undefined;
      manifests.set(uuid, isObject(m) ? m : null);
    }
    return manifests.get(uuid);
  };
  const hasButtons = (m) => (Array.isArray(m.Controllers) ? m.Controllers : []).some((c) => isObject(c?.Actions) && Object.keys(c.Actions).length);
  // A listed page that isn't there is skipped; the Default page only counts when it has buttons
  const queue = [];
  for (const uuid of new Set(order)) {
    const m = readPage(uuid);
    if (!m) { report.missingPages++; continue; }
    if (uuid === def && !hasButtons(m)) continue;
    if (queue.length < LIMITS.pages) queue.push({ uuid, folder: false });
  }
  const ids = new Map(); // uuid → page id
  const marks = {};
  const images = [];
  const imageIndex = new Map();
  const pages = [];
  let maxCol = 0;
  let maxRow = 0;
  let nextButton = 1;
  const count = (group, reason) => { report[group][reason] = (report[group][reason] || 0) + 1; };

  let nextPage = 1;
  const assign = (item) => {
    const id = 'p' + nextPage++;
    ids.set(item.uuid, id);
    return id;
  };
  for (const item of queue) assign(item);

  const ctx = {
    keys,
    image: (src) => {
      if (!imageIndex.has(src)) { imageIndex.set(src, images.length); images.push(src); }
      return imageIndex.get(src);
    },
    folder: (uuid, action) => {
      const u = typeof uuid === 'string' ? uuid.toLowerCase() : '';
      if (!u || !readPage(u)) return { reason: 'missingPage' };
      if (ids.has(u)) return { id: ids.get(u) };
      if (nextPage > LIMITS.pages) return { reason: 'tooManyPages' };
      const title = action?.States?.[0]?.Title;
      const item = { uuid: u, folder: true, title: typeof title === 'string' ? title.replace(/\s+/g, ' ').trim() : '' };
      queue.push(item);
      return { id: assign(item) };
    },
  };

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    const pageDir = folders.get(item.uuid);
    const m = readPage(item.uuid);
    const page = { id: ids.get(item.uuid), uuid: item.uuid, folder: item.folder, folderTitle: item.title, name: typeof m.Name === 'string' && m.Name.trim() ? m.Name : undefined, buttons: [] };
    for (const c of Array.isArray(m.Controllers) ? m.Controllers : []) {
      if (!isObject(c) || !isObject(c.Actions)) continue;
      if (c.Type && c.Type !== 'Keypad') { report.dials += Object.keys(c.Actions).length; continue; }
      for (const [pos, a] of Object.entries(c.Actions)) {
        const mm = /^(\d{1,2}),(\d{1,2})$/.exec(pos);
        if (!mm || !isObject(a)) continue;
        report.buttons++;
        const col = Number(mm[1]);
        const row = Number(mm[2]);
        const id = 'b' + nextButton++;
        if (col >= LIMITS.grid || row >= LIMITS.grid) { count('notImported', 'outside'); continue; }
        const act = convertAction(a, ctx);
        const states = Array.isArray(a.States) ? a.States : [];
        const b = { id, col, row, type: act.type, ...lookOf(states[0], ctx, pageDir) };
        if (act.key) b.key = act.key;
        if (act.keys) {
          b.keys = act.keys;
          const alt = lookOf(states[1], ctx, pageDir);
          b.alt = { label: alt.label, icon: alt.icon, textColor: alt.textColor };
        }
        if (act.page) b.page = act.page;
        if (act.type === 'none') { count('notImported', act.reason); marks[id] = { kind: 'none', reason: act.reason, detail: act.detail }; } else {
          report.imported++;
          if (act.adapted) { count('adapted', act.adapted); marks[id] = { kind: 'check', reason: act.adapted }; }
          if (act.review) { report.review++; marks[id] = marks[id] || { kind: 'check', reason: 'review' }; }
        }
        maxCol = Math.max(maxCol, col + 1);
        maxRow = Math.max(maxRow, row + 1);
        page.buttons.push(b);
      }
    }
    pages.push(page);
  }

  if (!pages.length) throw new ProfileError('empty');
  report.pages = pages.length;

  return {
    format,
    source: keys.source,
    name: typeof top.Name === 'string' ? top.Name.trim().slice(0, LIMITS.text) : '',
    apps: appsFor(top.AppIdentifier),
    model,
    panel: {
      format: 1,
      grid: gridFor(model, { cols: maxCol, rows: maxRow }),
      style: { theme: 'keys' },
      pages: pages.map((p) => ({ id: p.id, name: p.name, folder: p.folder, folderTitle: p.folderTitle, layout: 'grid', buttons: p.buttons })),
    },
    images,
    report,
    marks,
  };
}

// Puts the final names of the images in: files[n] is "images/….png", or null when image n couldn't
// be read (its icons are dropped). Also drops the helper fields of the pages.
function resolveImages(panel, files) {
  const fix = (look) => {
    if (look?.icon?.kind !== 'image') return;
    const n = Number(String(look.icon.file).replace(/^src:/, ''));
    if (files[n]) look.icon.file = files[n]; else delete look.icon;
  };
  for (const p of panel.pages) {
    delete p.folder;
    delete p.folderTitle;
    for (const b of p.buttons) { fix(b); fix(b.alt); }
  }
  return panel;
}

// Reads a .streamDeckProfile: the zip goes through the installer's safe extraction (paths, links,
// size and number of files), and the extracted folder is removed with cleanup() once the main
// process has read the images.
async function readProfile(file, opts = {}) {
  const { extractZip } = require('./installer');
  let dir;
  try { dir = await extractZip(file, opts.limits); } catch (e) { throw new ProfileError('notZip', e.message); }
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true });
  try {
    return { ...convert(dir, opts), cleanup };
  } catch (e) {
    cleanup();
    throw e;
  }
}

module.exports = { readProfile, convert, resolveImages, base32Uuid, appsFor, ProfileError, MODELS, REASONS };
