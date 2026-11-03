// UI strings. One JSON file per language; missing keys fall back to English.
const dicts = {
  en: require('./en.json'),
  es: require('./es.json'),
};

// The user's choice ("es", "en") wins; "auto" or nothing follows the system language, else English
function pickLocale(preference, systemLocale) {
  if (preference && preference !== 'auto' && dicts[preference]) return preference;
  const lang = String(systemLocale || '').toLowerCase().split(/[-_]/)[0];
  return dicts[lang] ? lang : 'en';
}

// Every string for a language, with English filling the gaps (this is what the renderer receives)
function strings(locale) {
  return { ...dicts.en, ...(dicts[locale] || {}) };
}

// t('key', { name: 'x' }) replaces {name} in the string
function translator(locale) {
  const d = strings(locale);
  return (key, vars = {}) => (d[key] ?? key).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

module.exports = { pickLocale, strings, translator, languages: Object.keys(dicts) };
