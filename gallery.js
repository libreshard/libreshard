// The gallery: shards reviewed in the libreshard/shards repository, listed by libreshard.com in
// gallery/index.json. The app reads that index only when the user opens the gallery (and, later,
// with the daily check for new versions); it never trusts it blindly: every entry is checked like
// a manifest, and a file is only installed if its sha256 and size match the entry, then goes
// through the usual review like any other shard.
const fs = require('fs');
const crypto = require('crypto');
const { normalize } = require('./keys');
const { httpsUrl, compareVersions } = require('./manifest');

const INDEX_URL = 'https://libreshard.com/gallery/index.json';
const FORMAT = 1;
const TAGS = ['games', 'streaming', 'creative', 'video', 'audio', 'office', 'development', 'desktop', 'accessibility', 'other'];
const ID = /^[a-z0-9-]{1,64}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^\d+(\.\d+){0,2}([-+][0-9A-Za-z.-]+)?$/;
const LICENSE = /^(?=.*[A-Za-z0-9])[A-Za-z0-9.+\-() ]{1,64}$/;
const MAX_ENTRIES = 2000;
const MAX_BYTES = 50 * 1024 * 1024;
// Versions typed by hand in a manifest may not parse: then they count as equal
const newer = (a, b) => { try { return compareVersions(a, b) > 0; } catch { return false; } };

const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v, max) => (typeof v === 'string' && v.trim() && !/[\u0000-\u001f\u007f]/.test(v) ? [...v.trim()].slice(0, max).join('') : undefined);

// One entry, or null to leave it out (a bad entry never hides the others)
function cleanEntry(e) {
  if (!isObject(e) || typeof e.id !== 'string' || !ID.test(e.id)) return null;
  const name = text(e.name, 60);
  const author = text(e.author, 60);
  const description = text(e.description, 160);
  if (!name || !author || !description) return null;
  if (typeof e.version !== 'string' || !VERSION.test(e.version)) return null;
  if (typeof e.license !== 'string' || !LICENSE.test(e.license)) return null;
  if (!Array.isArray(e.keys) || !e.keys.length || e.keys.length > 300 || e.keys.some((k) => typeof k !== 'string' || k.length > 64)) return null;
  const out = {
    id: e.id, name, author, description,
    icon: text(e.icon, 16),
    version: e.version,
    minAppVersion: typeof e.minAppVersion === 'string' && VERSION.test(e.minAppVersion) ? e.minAppVersion : undefined,
    license: e.license,
    url: httpsUrl(e.url) || undefined,
    tags: Array.isArray(e.tags) ? e.tags.filter((t) => TAGS.includes(t)).slice(0, 3) : [],
    keys: [...new Set(e.keys.map(normalize))],
    apps: Array.isArray(e.apps) ? e.apps.map((a) => text(a, 100)).filter(Boolean).slice(0, 20) : [],
    paid: e.paid === true,
  };
  if (out.paid) {
    out.price = text(e.price, 40);
    out.buyUrl = httpsUrl(e.buyUrl) || undefined;
    if (!out.price || !out.buyUrl) return null;
  } else {
    const d = e.download;
    if (!isObject(d) || !httpsUrl(d.url) || typeof d.sha256 !== 'string' || !SHA256.test(d.sha256) || !Number.isInteger(d.size) || d.size <= 0 || d.size > MAX_BYTES) return null;
    out.download = { url: httpsUrl(d.url), sha256: d.sha256, size: d.size };
  }
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

// The parsed index → its entries, sorted by name (ids are unique: the first one wins). Throws if
// it isn't an index this version understands.
function cleanIndex(raw) {
  if (!isObject(raw) || !Array.isArray(raw.shards)) throw new Error('not a gallery index');
  if (raw.format !== FORMAT) throw new Error(raw.format > FORMAT ? 'newer gallery format' : 'unknown gallery format');
  const seen = new Set();
  const entries = [];
  for (const e of raw.shards.slice(0, MAX_ENTRIES)) {
    const c = cleanEntry(e);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    entries.push(c);
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

// Whether a downloaded file is the one the entry pins
function matchesEntry(file, entry) {
  const st = fs.statSync(file);
  if (st.size !== entry.download.size) return false;
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  return sha === entry.download.sha256;
}

// The entry an installed shard corresponds to: the one it was installed from, or one with the same
// id and author (a shard bought and installed from its file, for example)
function entryFor(entries, shard) {
  const e = entries.find((x) => x.id === shard.id);
  if (!e) return null;
  if (shard.source?.kind === 'gallery' && shard.source.id === e.id) return e;
  return shard.author && shard.author === e.author ? e : null;
}

// For the gallery view and the shard cards: per entry, whether it's installed, whether the entry
// is newer, and whether this LibreShard is too old for it. `installed`: [{ id, version, author,
// source, bundled }]
function annotate(entries, installed, appVersion) {
  return entries.map((e) => {
    const shard = installed.find((s) => s.id === e.id);
    const mine = shard && !shard.bundled && entryFor([e], shard) ? shard : null;
    return {
      ...e,
      installed: shard ? { version: shard.version || null, same: !!mine } : null,
      update: !!(mine && mine.version && newer(e.version, mine.version)),
      needsApp: !!(e.minAppVersion && newer(e.minAppVersion, appVersion)),
    };
  });
}

module.exports = { INDEX_URL, FORMAT, TAGS, cleanIndex, cleanEntry, matchesEntry, entryFor, annotate };
