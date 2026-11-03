const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pickLocale, translator, strings } = require('../i18n');

const es = require('../i18n/es.json');
const en = require('../i18n/en.json');

test('Spanish and English have exactly the same keys', () => {
  assert.deepEqual(Object.keys(es).sort(), Object.keys(en).sort());
});

test('both languages use the same {placeholders} in every string', () => {
  const vars = (s) => (s.match(/\{\w+\}/g) || []).sort();
  for (const k of Object.keys(en)) assert.deepEqual(vars(es[k]), vars(en[k]), k);
});

test('every key the code asks for exists', () => {
  const root = path.join(__dirname, '..');
  const used = new Set();
  for (const file of ['main.js', 'desktop/app.js', 'desktop/index.html', 'viewer/app.js', 'viewer/index.html']) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    for (const m of src.matchAll(/\bt\('([\w.]+)'\s*[,)]/g)) used.add(m[1]); // whole keys, not 'prefix.' + x
    for (const m of src.matchAll(/data-i18n(?:-aria)?="([\w.]+)"/g)) used.add(m[1]);
  }
  // Built from a variable: settings.language.<code>
  for (const l of ['auto', 'es', 'en']) used.add('settings.language.' + l);
  const missing = [...used].filter((k) => !(k in en));
  assert.deepEqual(missing, []);
  assert.ok(used.size > 50, 'the scan found the keys');
});

test('pickLocale follows the preference, then the system, then English', () => {
  assert.equal(pickLocale('en', 'es-ES'), 'en');
  assert.equal(pickLocale('auto', 'es-MX'), 'es');
  assert.equal(pickLocale(undefined, 'es_AR'), 'es');
  assert.equal(pickLocale('auto', 'fr-FR'), 'en');
  assert.equal(pickLocale('xx', 'de'), 'en');
});

test('the translator fills placeholders and falls back to the key', () => {
  const t = translator('es');
  assert.equal(t('shards.by', { author: 'Ana' }), 'por Ana');
  assert.equal(t('no.such.key'), 'no.such.key');
  assert.equal(strings('fr')['action.save'], 'Save');
});
