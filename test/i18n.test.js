const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pickLocale, translator, strings, languages, machine } = require('../i18n');

const es = require('../i18n/es.json');
const en = require('../i18n/en.json');
const dict = (l) => require(`../i18n/${l}.json`);
// Languages translated by AI (see i18n/README.md): a missing text falls back to English
const others = languages.filter((l) => l !== 'en' && l !== 'es');
const vars = (s) => (s.match(/\{\w+\}/g) || []).sort();

test('Spanish and English have exactly the same keys', () => {
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
});

test('every language uses the same {placeholders} as English in every string it has', () => {
  for (const l of languages) {
    const d = dict(l);
    for (const k of Object.keys(d)) if (k in en) assert.deepEqual(vars(d[k]), vars(en[k]), `${l}: ${k}`);
  }
});

test('the other languages only have keys English has, and every text is plain, non-empty text', () => {
  assert.deepEqual(others.sort(), machine.slice().sort(), 'every language but English and Spanish is marked as translated by AI');
  for (const l of others) {
    const d = dict(l);
    assert.deepEqual(Object.keys(d).filter((k) => !(k in en)), [], `${l}: keys English doesn't have`);
    for (const [k, v] of Object.entries(d)) assert.ok(typeof v === 'string' && v.trim(), `${l}: ${k} is empty`);
  }
});

// Not failures: a missing text shows in English, and a long one may still fit. Run with
// --test-reporter=spec to see them; they're completed before each release.
test('the other languages: missing texts, and texts much longer than English (warnings)', (t) => {
  for (const l of others) {
    const d = dict(l);
    const missing = Object.keys(en).filter((k) => !(k in d));
    if (missing.length) t.diagnostic(`${l}: ${missing.length} texts missing (shown in English): ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}`);
    const long = Object.keys(d).filter((k) => en[k].length >= 20 && d[k].length > en[k].length * 1.5);
    if (long.length) t.diagnostic(`${l}: ${long.length} texts over 1.5 times the English length: ${long.slice(0, 10).join(', ')}${long.length > 10 ? '…' : ''}`);
  }
});

test('each language is named in its own language, the same in every file', () => {
  for (const code of languages) {
    const names = languages.map((l) => dict(l)[`settings.language.${code}`]).filter(Boolean);
    assert.ok(names.length, code);
    assert.equal(new Set(names).size, 1, `settings.language.${code} differs between languages`);
  }
});

test('every key the code asks for exists', () => {
  const root = path.join(__dirname, '..');
  const used = new Set();
  for (const file of ['main.js', 'desktop/app.js', 'desktop/index.html', 'viewer/app.js', 'viewer/index.html', 'desktop/editor.js', 'desktop/editor.html']) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    for (const m of src.matchAll(/\bt\('([\w.]+)'\s*[,)]/g)) used.add(m[1]); // whole keys, not 'prefix.' + x
    for (const m of src.matchAll(/data-i18n(?:-aria)?="([\w.]+)"/g)) used.add(m[1]);
  }
  // Built from a variable: settings.language.<code>
  for (const l of ['auto', ...languages]) used.add('settings.language.' + l);
  const missing = [...used].filter((k) => !(k in en));
  assert.deepEqual(missing, []);
  assert.ok(used.size > 50, 'the scan found the keys');
});

test('pickLocale follows the preference, then the system, then English', () => {
  assert.equal(pickLocale('en', 'es-ES'), 'en');
  assert.equal(pickLocale('auto', 'es-MX'), 'es');
  assert.equal(pickLocale(undefined, 'es_AR'), 'es');
  assert.equal(pickLocale('auto', 'fr-FR'), 'fr');
  assert.equal(pickLocale('auto', 'fr-CA'), 'fr');
  assert.equal(pickLocale('auto', 'pt-BR'), 'pt');
  assert.equal(pickLocale('auto', 'pt-PT'), 'pt', 'Portugal gets the Brazilian translation');
  assert.equal(pickLocale('pt', 'es-MX'), 'pt');
  assert.equal(pickLocale('auto', 'de-DE'), 'en');
  assert.equal(pickLocale('xx', 'de'), 'en');
});

test('the translator fills placeholders and falls back to the key', () => {
  const t = translator('es');
  assert.equal(t('shards.by', { author: 'Ana' }), 'por Ana');
  assert.equal(t('no.such.key'), 'no.such.key');
  assert.equal(strings('xx')['action.save'], 'Save', 'an unknown language gets English');
});
