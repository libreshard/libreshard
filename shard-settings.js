// Per-shard settings: the author declares them in the manifest ("settings"), the user sets them in
// the PC window, and the shard reads them with Shard.settings(). Values are data only, always checked
// against the declaration, so a setting can never become code or exceed its limits.
//
//   "settings": [
//     { "id": "layout", "type": "select", "label": "Layout", "options": ["compact", "wide"], "default": "wide" },
//     { "id": "confirm", "type": "toggle", "label": { "en": "Confirm", "es": "Confirmar" }, "default": true },
//     { "id": "size", "type": "number", "label": "Size", "min": 1, "max": 10, "step": 1, "default": 5 },
//     { "id": "title", "type": "text", "label": "Title", "maxLength": 40 },
//     { "id": "accent", "type": "color", "label": "Accent", "default": "#22d3ee" }
//   ]

const TYPES = ['toggle', 'select', 'number', 'text', 'color'];
const ID = /^[a-z0-9_-]{1,32}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const MAX_SETTINGS = 30;
const MAX_OPTIONS = 20;

// A label is text, or { "en": "...", "es": "..." }
function cleanLabel(v, max = 60) {
  if (typeof v === 'string' && v.trim()) return v.trim().slice(0, max);
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const out = {};
    for (const [lang, text] of Object.entries(v)) {
      if (/^[a-z]{2}$/.test(lang) && typeof text === 'string' && text.trim()) out[lang] = text.trim().slice(0, max);
    }
    if (Object.keys(out).length) return out;
  }
  return null;
}

// The label in the user's language, else English, else the first one
function labelFor(label, locale) {
  if (typeof label === 'string') return label;
  return label?.[locale] ?? label?.en ?? Object.values(label || {})[0] ?? '';
}

// A value for one setting, or undefined if it isn't valid
function cleanValue(item, v) {
  switch (item.type) {
    case 'toggle': return typeof v === 'boolean' ? v : undefined;
    case 'select': return item.options.some((o) => o.value === v) ? v : undefined;
    case 'number': {
      if (typeof v !== 'number' || !Number.isFinite(v)) return undefined;
      return Math.min(item.max ?? Infinity, Math.max(item.min ?? -Infinity, v));
    }
    case 'text': return typeof v === 'string' ? v.slice(0, item.maxLength) : undefined;
    case 'color': return typeof v === 'string' && COLOR.test(v) ? v.toLowerCase() : undefined;
    default: return undefined;
  }
}

const FALLBACK = { toggle: false, text: '', color: '#22d3ee' };

// Checks the manifest's "settings". Returns { errors, schema } with a clean schema.
function validateSchema(list) {
  const errors = [];
  if (list === undefined) return { errors, schema: [] };
  if (!Array.isArray(list)) return { errors: ['"settings" must be a list'], schema: [] };
  if (list.length > MAX_SETTINGS) return { errors: [`"settings" has more than ${MAX_SETTINGS} entries`], schema: [] };

  const schema = [];
  const seen = new Set();
  for (const [i, raw] of list.entries()) {
    const where = `setting ${i + 1}`;
    if (!raw || typeof raw !== 'object') { errors.push(`${where} must be an object`); continue; }
    if (typeof raw.id !== 'string' || !ID.test(raw.id)) { errors.push(`${where}: "id" must use lowercase letters, digits, "-" or "_" (max 32)`); continue; }
    if (seen.has(raw.id)) { errors.push(`setting "${raw.id}" is repeated`); continue; }
    seen.add(raw.id);
    if (!TYPES.includes(raw.type)) { errors.push(`setting "${raw.id}": "type" must be one of ${TYPES.join(', ')}`); continue; }
    const label = cleanLabel(raw.label);
    if (!label) { errors.push(`setting "${raw.id}" needs a "label"`); continue; }

    const item = { id: raw.id, type: raw.type, label };
    if (raw.type === 'select') {
      const options = Array.isArray(raw.options) ? raw.options.slice(0, MAX_OPTIONS).map((o) => {
        if (typeof o === 'string' && o.trim()) return { value: o.trim().slice(0, 40), label: o.trim().slice(0, 40) };
        if (o && typeof o.value === 'string' && o.value.trim()) return { value: o.value.trim().slice(0, 40), label: cleanLabel(o.label, 40) || o.value.trim().slice(0, 40) };
        return null;
      }).filter(Boolean) : [];
      if (!options.length) { errors.push(`setting "${raw.id}" needs "options"`); continue; }
      item.options = options;
    }
    if (raw.type === 'number') {
      for (const k of ['min', 'max', 'step']) {
        if (raw[k] !== undefined) {
          if (typeof raw[k] !== 'number' || !Number.isFinite(raw[k])) errors.push(`setting "${raw.id}": "${k}" must be a number`);
          else item[k] = raw[k];
        }
      }
      if (item.min !== undefined && item.max !== undefined && item.min > item.max) errors.push(`setting "${raw.id}": "min" is above "max"`);
    }
    if (raw.type === 'text') item.maxLength = Number.isInteger(raw.maxLength) && raw.maxLength > 0 ? Math.min(raw.maxLength, 200) : 100;

    const fallback = item.type === 'select' ? item.options[0].value : item.type === 'number' ? (item.min ?? 0) : FALLBACK[item.type];
    if (raw.default === undefined) item.default = cleanValue(item, fallback);
    else {
      item.default = cleanValue(item, raw.default);
      if (item.default === undefined) { errors.push(`setting "${raw.id}": "default" isn't valid for a ${item.type}`); continue; }
    }
    schema.push(item);
  }
  return { errors, schema };
}

// Every declared setting with a valid value: the saved one when valid, else the default
function resolveValues(schema, saved = {}) {
  const out = {};
  for (const item of schema) {
    const v = saved && Object.prototype.hasOwnProperty.call(saved, item.id) ? cleanValue(item, saved[item.id]) : undefined;
    out[item.id] = v === undefined ? item.default : v;
  }
  return out;
}

// Checks values sent from the PC window: every key must be declared and valid
function checkValues(schema, values) {
  if (!values || typeof values !== 'object' || Array.isArray(values)) throw new Error('Settings must be an object');
  const out = {};
  for (const [id, v] of Object.entries(values)) {
    const item = schema.find((s) => s.id === id);
    if (!item) throw new Error(`Unknown setting "${id}"`);
    const clean = cleanValue(item, v);
    if (clean === undefined) throw new Error(`Invalid value for "${id}"`);
    out[id] = clean;
  }
  return out;
}

module.exports = { validateSchema, resolveValues, checkValues, cleanValue, labelFor };
