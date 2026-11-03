// Shard manifest validation and key risk classification.
const { parse, normalize } = require('./keys');
const { validateSchema } = require('./shard-settings');

const ID = /^[a-z0-9-]{1,64}$/;
const MAX_KEYS = 300;

// "1.2.3" → [1, 2, 3]; anything after a "-" or "+" (pre-release, build) is ignored
function versionParts(v) {
  if (typeof v !== 'string' || !/^\d+(\.\d+){0,2}([-+].*)?$/.test(v.trim())) return null;
  const p = v.trim().split(/[-+]/)[0].split('.').map(Number);
  while (p.length < 3) p.push(0);
  return p;
}

// < 0 if a is older than b, 0 if equal, > 0 if newer
function compareVersions(a, b) {
  const x = versionParts(a);
  const y = versionParts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

const optionalString = (m, field, max, errors) => {
  if (m[field] === undefined) return undefined;
  if (typeof m[field] !== 'string') { errors.push(`"${field}" must be text`); return undefined; }
  return m[field].trim().slice(0, max);
};

// Checks a parsed manifest.json. Returns { ok, errors, manifest } where `manifest` keeps only the
// known fields, cleaned up. `appVersion` is LibreShard's own version, for "minAppVersion".
function validateManifest(m, { appVersion } = {}) {
  const errors = [];
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, errors: ['manifest must be a JSON object'] };

  if (typeof m.id !== 'string' || !ID.test(m.id)) errors.push('"id" must use only lowercase letters, digits and hyphens (max 64)');

  const out = {
    id: m.id,
    name: optionalString(m, 'name', 60, errors),
    author: optionalString(m, 'author', 60, errors),
    version: optionalString(m, 'version', 20, errors),
    icon: optionalString(m, 'icon', 16, errors),
    description: optionalString(m, 'description', 300, errors),
  };

  if (m.apps !== undefined) {
    const apps = typeof m.apps === 'string' ? [m.apps] : m.apps;
    if (!Array.isArray(apps) || apps.some((a) => typeof a !== 'string')) errors.push('"apps" must be a list of texts');
    else out.apps = apps.map((a) => a.trim().slice(0, 100)).filter(Boolean).slice(0, 20);
  }

  const keys = m.permissions?.keys ?? [];
  if (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string')) {
    errors.push('"permissions.keys" must be a list of texts');
  } else if (keys.length > MAX_KEYS) {
    errors.push(`"permissions.keys" has more than ${MAX_KEYS} entries`);
  } else {
    out.keys = [...new Set(keys.map(normalize))];
    for (const k of out.keys) {
      try { parse(k); } catch { errors.push(`unknown key "${k}"`); }
    }
  }

  const settings = validateSchema(m.settings);
  errors.push(...settings.errors);
  out.settings = settings.schema;

  if (m.minAppVersion !== undefined) {
    if (!versionParts(m.minAppVersion)) errors.push('"minAppVersion" must look like "1.2.3"');
    else {
      out.minAppVersion = m.minAppVersion.trim();
      if (appVersion && compareVersions(appVersion, out.minAppVersion) < 0) {
        errors.push(`needs LibreShard ${out.minAppVersion} or newer (this is ${appVersion})`);
      }
    }
  }

  return { ok: errors.length === 0, errors, manifest: out };
}

const SYSTEM = new Set(['win', 'meta', 'cmd']);
const CTRL = new Set(['ctrl', 'control', 'lctrl', 'rctrl']);
const ALT = new Set(['alt', 'lalt', 'ralt']);
const TYPING = /^([a-z0-9]|space|comma|period|minus|equal|slash|semicolon|apostrophe)$/;

// Sorts a shard's keys by risk, for the install review:
// - dangerous: system combos (win/meta/cmd, alt+f4, ctrl+alt+…)
// - canType: enough plain characters plus enter to type and run arbitrary text
// - warning: both at once (for example win+r, then a command, then enter)
function classifyKeys(keys) {
  const dangerous = [];
  const normal = [];
  let typing = 0;
  let enter = false;
  for (const combo of keys.map(normalize)) {
    const parts = combo.split('+');
    const mods = parts.slice(0, -1);
    const last = parts[parts.length - 1];
    const isDangerous = parts.some((p) => SYSTEM.has(p)) || combo === 'alt+f4' ||
      (parts.some((p) => CTRL.has(p)) && parts.some((p) => ALT.has(p)));
    if (isDangerous) dangerous.push(combo); else normal.push(combo);
    if (mods.every((p) => p === 'shift') && TYPING.test(last)) typing++;
    if (last === 'enter' || last === 'numpadenter') enter = true;
  }
  const canType = typing >= 10 && enter;
  return { dangerous, normal, canType, warning: dangerous.length > 0 && canType };
}

module.exports = { validateManifest, classifyKeys, compareVersions };
