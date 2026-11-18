// UI strings. One JSON file per language; missing keys fall back to English. English and Spanish
// are complete and written by the maintainer; see README.md here for the others.
const dicts = {
  en: require('./en.json'),
  es: require('./es.json'),
  fr: require('./fr.json'),
  pt: require('./pt.json'), // Brazilian Portuguese: pt-PT also falls back to it (pickLocale uses the base language)
};
// Translated by AI and not reviewed by a person yet: the PC window says so next to the language
const MACHINE = ['fr', 'pt'];

// The user's choice ("es", "fr"…) wins; "auto" or nothing follows the system language, else English
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

module.exports = { pickLocale, strings, translator, languages: Object.keys(dicts), machine: MACHINE };
