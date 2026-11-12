// Backups: settings, app rules, each shard's state and the shards the user installed, in one zip.
//
// What goes in: config.json (minus internal values such as the panel's position), app-rules.json,
// and per shard whether it's enabled, a favorite, its place in the menu and its settings values,
// plus the files of every shard the user installed (not bundled ones, not development links).
// What never goes in: paired devices (their tokens belong to that PC), key approvals (an imported
// shard always goes through the install review again), the log, and what the tablets store.
//
// Reading a backup trusts nothing in it: the zip goes through the installer's extraction (paths,
// links, size and file count limits) and every value is checked again before the app applies it.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { extractZip } = require('./installer');
const { cleanRule } = require('./shard-store');

const FORMAT = 1;
const ID = /^[a-z0-9-]{1,64}$/; // the manifest's id rule: also safe as a folder name
// Several shards fit in a backup, so the limits are wider than for one shard
const LIMITS = { maxBytes: 300 * 1024 * 1024, maxFiles: 20000 };

/* ---------- Writing ---------- */

// A plain zip (deflate, UTF-8 names) from [{ name, data: Buffer }]
function writeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const packed = zlib.deflateRawSync(data);
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // made by Unix, so the mode below counts
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); // a regular file
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + packed.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

// Every plain file under root, as paths relative to it with "/" (links are skipped, like install())
function filesUnder(root, rel = '') {
  const out = [];
  for (const d of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (d.isSymbolicLink()) continue;
    if (d.isDirectory()) out.push(...filesUnder(root, r));
    else if (d.isFile()) out.push(r);
  }
  return out;
}

// The part of a shard's saved state that a backup keeps (never "approved")
function shardState(st = {}) {
  const out = {};
  if (st.disabled) out.disabled = true;
  if (st.favorite) out.favorite = true;
  if (Number.isInteger(st.position)) out.position = st.position;
  if (st.settings && typeof st.settings === 'object') out.settings = st.settings;
  return out;
}

// config: the app's settings, already without internal ones. rules: app-rules.json as an object.
// state: shards-state.json. shards: the store's entries. Returns the zip as a Buffer.
function createBackup({ appVersion, config, rules, state, shards, now = new Date() }) {
  const installed = shards.filter((e) => !e.bundled && !e.linked);
  const data = {
    format: FORMAT,
    app: 'LibreShard',
    appVersion,
    createdAt: now.toISOString(),
    config,
    appRules: rules || {},
    shards: Object.fromEntries(shards.map((e) => [e.id, shardState(state[e.id])]).filter(([, s]) => Object.keys(s).length)),
    installed: installed.map((e) => e.id),
  };
  const entries = [{ name: 'backup.json', data: Buffer.from(JSON.stringify(data, null, 2) + '\n') }];
  for (const e of installed) {
    for (const rel of filesUnder(e.root)) entries.push({ name: `shards/${e.id}/${rel}`, data: fs.readFileSync(path.join(e.root, rel)) });
  }
  return writeZip(entries);
}

/* ---------- Reading ---------- */

const plainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// Checks a parsed backup.json. settings: the app's SETTINGS (each { valid, internal }).
// Returns { ok, errors, data } with only valid values kept.
function checkBackup(raw, settings) {
  if (!plainObject(raw) || raw.app !== 'LibreShard' || !Number.isInteger(raw.format)) return { ok: false, errors: ['This is not a LibreShard backup'] };
  if (raw.format > FORMAT) return { ok: false, errors: ['This backup comes from a newer LibreShard; update this one first'] };
  const config = {};
  for (const [k, v] of Object.entries(plainObject(raw.config) ? raw.config : {})) {
    if (Object.hasOwn(settings, k) && !settings[k].internal && settings[k].valid(v)) config[k] = v;
  }
  const appRules = {};
  for (const [id, v] of Object.entries(plainObject(raw.appRules) ? raw.appRules : {})) {
    const rule = ID.test(id) ? cleanRule(v) : null;
    if (rule) appRules[id] = rule.mode === 'any' ? { mode: 'any' } : { mode: 'only', apps: rule.apps };
  }
  const shards = {};
  for (const [id, v] of Object.entries(plainObject(raw.shards) ? raw.shards : {})) {
    if (!ID.test(id) || !plainObject(v)) continue;
    const s = {};
    if (v.disabled === true) s.disabled = true;
    if (v.favorite === true) s.favorite = true;
    if (Number.isInteger(v.position) && v.position >= 0 && v.position < 10000) s.position = v.position;
    if (plainObject(v.settings)) s.settings = v.settings; // checked against the manifest when applied
    shards[id] = s;
  }
  const installed = Array.isArray(raw.installed) ? [...new Set(raw.installed.filter((id) => typeof id === 'string' && ID.test(id)))] : [];
  return {
    ok: true,
    errors: [],
    data: {
      appVersion: typeof raw.appVersion === 'string' ? raw.appVersion.slice(0, 40) : '',
      createdAt: typeof raw.createdAt === 'string' && !Number.isNaN(Date.parse(raw.createdAt)) ? raw.createdAt : null,
      config, appRules, shards, installed,
    },
  };
}

// Extracts a backup into a temporary folder and checks it. Resolves with
// { ok, errors, data, dir, shardDir(id), cleanup() }; shards listed as installed but missing from
// the zip are left out.
async function readBackup(file, { settings, limits = LIMITS }) {
  const dir = await extractZip(file, limits);
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(path.join(dir, 'backup.json'), 'utf8'));
  } catch {
    cleanup();
    return { ok: false, errors: ['This is not a LibreShard backup'] };
  }
  const r = checkBackup(raw, settings);
  if (!r.ok) { cleanup(); return r; }
  const shardDir = (id) => path.join(dir, 'shards', id);
  r.data.installed = r.data.installed.filter((id) => fs.existsSync(path.join(shardDir(id), 'manifest.json')));
  return { ...r, dir, shardDir, cleanup };
}

module.exports = { createBackup, readBackup, checkBackup, writeZip, FORMAT, LIMITS };
