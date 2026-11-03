const test = require('node:test');
const assert = require('node:assert/strict');
const { validateSchema, resolveValues, checkValues, labelFor } = require('../shard-settings');
const { validateManifest } = require('../manifest');

const SCHEMA = [
  { id: 'layout', type: 'select', label: 'Layout', options: ['compact', { value: 'wide', label: { en: 'Wide', es: 'Amplia' } }], default: 'wide' },
  { id: 'confirm', type: 'toggle', label: { en: 'Confirm', es: 'Confirmar' }, default: true },
  { id: 'size', type: 'number', label: 'Size', min: 1, max: 10, step: 1 },
  { id: 'title', type: 'text', label: 'Title', maxLength: 5 },
  { id: 'accent', type: 'color', label: 'Accent' },
];

test('a valid schema is kept, with defaults filled in', () => {
  const { errors, schema } = validateSchema(SCHEMA);
  assert.deepEqual(errors, []);
  assert.deepEqual(schema.map((s) => [s.id, s.default]), [['layout', 'wide'], ['confirm', true], ['size', 1], ['title', ''], ['accent', '#22d3ee']]);
  assert.deepEqual(schema[0].options, [{ value: 'compact', label: 'compact' }, { value: 'wide', label: { en: 'Wide', es: 'Amplia' } }]);
  assert.equal(schema[3].maxLength, 5);
});

test('bad schemas explain what is wrong', () => {
  const err = (list) => validateSchema(list).errors.join(' | ');
  assert.match(err('nope'), /must be a list/);
  assert.match(err([{ id: 'Bad Id', type: 'toggle', label: 'x' }]), /"id"/);
  assert.match(err([{ id: 'a', type: 'slider', label: 'x' }]), /"type"/);
  assert.match(err([{ id: 'a', type: 'toggle' }]), /needs a "label"/);
  assert.match(err([{ id: 'a', type: 'select', label: 'x' }]), /needs "options"/);
  assert.match(err([{ id: 'a', type: 'toggle', label: 'x', default: 'yes' }]), /"default" isn't valid/);
  assert.match(err([{ id: 'a', type: 'number', label: 'x', min: 5, max: 1 }]), /"min" is above "max"/);
  assert.match(err([{ id: 'a', type: 'toggle', label: 'x' }, { id: 'a', type: 'toggle', label: 'y' }]), /repeated/);
  assert.match(err(Array.from({ length: 31 }, (_, i) => ({ id: 's' + i, type: 'toggle', label: 'x' }))), /more than 30/);
});

test('saved values are used when valid; otherwise the default', () => {
  const { schema } = validateSchema(SCHEMA);
  assert.deepEqual(resolveValues(schema, { layout: 'compact', size: 50, title: 'abcdefgh', accent: 'red', confirm: 'yes', ghost: 1 }), {
    layout: 'compact', confirm: true, size: 10, title: 'abcde', accent: '#22d3ee',
  });
  assert.deepEqual(resolveValues(schema), { layout: 'wide', confirm: true, size: 1, title: '', accent: '#22d3ee' });
});

test('values from the PC window must be declared and valid', () => {
  const { schema } = validateSchema(SCHEMA);
  assert.deepEqual(checkValues(schema, { layout: 'compact', accent: '#ABCDEF' }), { layout: 'compact', accent: '#abcdef' });
  assert.throws(() => checkValues(schema, { ghost: 1 }), /Unknown setting/);
  assert.throws(() => checkValues(schema, { layout: 'huge' }), /Invalid value/);
  assert.throws(() => checkValues(schema, { size: 'big' }), /Invalid value/);
  assert.throws(() => checkValues(schema, null), /object/);
});

test('labels follow the language, then English, then the first one', () => {
  assert.equal(labelFor({ en: 'Confirm', es: 'Confirmar' }, 'es'), 'Confirmar');
  assert.equal(labelFor({ en: 'Confirm', es: 'Confirmar' }, 'fr'), 'Confirm');
  assert.equal(labelFor({ de: 'Bestätigen' }, 'fr'), 'Bestätigen');
  assert.equal(labelFor('Plain', 'es'), 'Plain');
});

test('the manifest validates its settings and rejects broken ones', () => {
  const ok = validateManifest({ id: 'demo', settings: SCHEMA });
  assert.ok(ok.ok);
  assert.equal(ok.manifest.settings.length, 5);
  assert.deepEqual(validateManifest({ id: 'demo' }).manifest.settings, []);
  const bad = validateManifest({ id: 'demo', settings: [{ id: 'a', type: 'slider', label: 'x' }] });
  assert.ok(!bad.ok);
});
