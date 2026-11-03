// The shards bundled with the app: all load, their keys parse, their manifests are complete, the
// shared base files are up to date and their translations are in sync.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { ShardStore } = require('../shard-store');
const { validateManifest } = require('../manifest');
const { parse } = require('../keys');
const { stale } = require('../tools/build-shard-base');

const root = path.join(__dirname, '..');
const shardsDir = path.join(root, 'shards');
const EXPECTED = ['desarrollo', 'discord-basico', 'edicion-imagen', 'escritorio', 'multimedia', 'obs', 'teclado-numerico', 'videollamadas'];

function store() {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'libreshard-bundled-'));
  const s = new ShardStore({ dirs: [{ dir: shardsDir, bundled: true }], stateFile: path.join(data, 'state.json') });
  return { s, cleanup: () => fs.rmSync(data, { recursive: true, force: true }) };
}

// window.SHARD_STRINGS from a shard's strings.js
function strings(id) {
  const file = path.join(shardsDir, id, 'strings.js');
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox);
  return sandbox.window.SHARD_STRINGS;
}

test('every bundled shard loads, none is rejected, and every key parses', () => {
  const { s, cleanup } = store();
  try {
    assert.deepEqual(s.rejected, [], 'rejected: ' + JSON.stringify(s.rejected));
    assert.deepEqual(s.all().map((e) => e.id).sort(), EXPECTED);
    for (const e of s.all()) {
      assert.ok(e.manifest.keys.length > 0, `${e.id} declares keys`);
      for (const k of e.manifest.keys) assert.doesNotThrow(() => parse(k), `${e.id}: ${k}`);
      assert.equal(e.pendingKeys.length, 0, `${e.id} is approved as bundled`);
    }
  } finally { cleanup(); }
});

test('bundled manifests are complete: name, icon, description, author', () => {
  for (const id of EXPECTED) {
    const raw = JSON.parse(fs.readFileSync(path.join(shardsDir, id, 'manifest.json'), 'utf8'));
    assert.equal(raw.id, id, 'the folder is named after the id');
    for (const field of ['name', 'icon', 'description', 'author', 'version']) assert.ok(raw[field], `${id}: ${field}`);
    assert.ok(raw.description.length <= 120, `${id}: the menu shows 120 characters`);
  }
});

test('the shared base files are up to date in every shard and the template', () => {
  assert.deepEqual(stale(), [], 'run npm run shards:base');
  for (const id of EXPECTED) {
    const html = fs.readFileSync(path.join(shardsDir, id, 'index.html'), 'utf8');
    assert.match(html, /href="libreshard\.css"/, `${id} uses the base styles`);
  }
});

test('each shard has English and Spanish texts with the same keys, covering its data-i18n', () => {
  for (const id of EXPECTED) {
    const dict = strings(id);
    assert.ok(dict && dict.en && dict.es, `${id}: en and es`);
    assert.deepEqual(Object.keys(dict.es).sort(), Object.keys(dict.en).sort(), `${id}: same keys`);
    const html = fs.readFileSync(path.join(shardsDir, id, 'index.html'), 'utf8');
    const used = [...html.matchAll(/data-(?:i18n|i18n-aria|armed-i18n|i18n-label)="([^"]+)"/g)].map((m) => m[1]);
    for (const key of used) assert.ok(key in dict.en, `${id}: "${key}" is missing from strings.js`);
  }
});

test('the authors\' template is a valid shard', () => {
  const dir = path.join(root, 'docs', 'shard-template');
  const { ok, errors } = validateManifest(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')), { appVersion: require('../package.json').version });
  assert.ok(ok, errors.join(', '));
  assert.ok(fs.existsSync(path.join(dir, 'index.html')));
});
