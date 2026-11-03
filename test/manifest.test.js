const test = require('node:test');
const assert = require('node:assert/strict');
const { validateManifest, classifyKeys, compareVersions } = require('../manifest');

const base = { id: 'demo', name: 'Demo', permissions: { keys: ['ctrl+s', 'F5'] } };

test('a valid manifest passes and its keys are normalized and deduplicated', () => {
  const r = validateManifest({ ...base, permissions: { keys: ['ctrl+s', 'Ctrl + S', 'F5'] } });
  assert.ok(r.ok, r.errors.join());
  assert.deepEqual(r.manifest.keys, ['ctrl+s', 'f5']);
});

test('unknown fields are dropped and texts are trimmed to their limits', () => {
  const r = validateManifest({ ...base, name: '  ' + 'n'.repeat(80), extra: 'ignored', size: { cols: 2 } });
  assert.ok(r.ok);
  assert.equal(r.manifest.name.length, 60);
  assert.equal(r.manifest.extra, undefined);
  assert.equal(r.manifest.size, undefined);
});

test('bad ids, types and keys are reported', () => {
  assert.ok(!validateManifest(null).ok);
  assert.ok(!validateManifest([]).ok);
  assert.match(validateManifest({ ...base, id: 'Bad Id' }).errors.join(), /"id"/);
  assert.match(validateManifest({ ...base, id: 'a'.repeat(65) }).errors.join(), /"id"/);
  assert.match(validateManifest({ ...base, name: 42 }).errors.join(), /"name" must be text/);
  assert.match(validateManifest({ ...base, apps: [1] }).errors.join(), /"apps"/);
  assert.match(validateManifest({ ...base, permissions: { keys: 'ctrl+s' } }).errors.join(), /permissions\.keys/);
  assert.match(validateManifest({ ...base, permissions: { keys: ['ctrl+banana'] } }).errors.join(), /unknown key "ctrl\+banana"/);
  const many = Array.from({ length: 301 }, (_, i) => 'f' + ((i % 24) + 1));
  assert.match(validateManifest({ ...base, permissions: { keys: many } }).errors.join(), /more than 300/);
});

test('a shard without keys is valid (it just can\'t press anything)', () => {
  const r = validateManifest({ id: 'empty' });
  assert.ok(r.ok);
  assert.deepEqual(r.manifest.keys, []);
});

test('apps accept a single string too', () => {
  assert.deepEqual(validateManifest({ ...base, apps: 'photoshop' }).manifest.apps, ['photoshop']);
});

test('minAppVersion is checked against the running version', () => {
  assert.ok(validateManifest({ ...base, minAppVersion: '0.1.0' }, { appVersion: '0.1.0' }).ok);
  assert.ok(validateManifest({ ...base, minAppVersion: '0.1' }, { appVersion: '0.2.0' }).ok);
  const r = validateManifest({ ...base, minAppVersion: '0.3.0' }, { appVersion: '0.2.5' });
  assert.ok(!r.ok);
  assert.match(r.errors.join(), /needs LibreShard 0\.3\.0 or newer \(this is 0\.2\.5\)/);
  assert.match(validateManifest({ ...base, minAppVersion: 'latest' }).errors.join(), /minAppVersion/);
});

test('compareVersions orders versions numerically', () => {
  assert.ok(compareVersions('0.10.0', '0.9.9') > 0);
  assert.ok(compareVersions('1.0.0', '1.0.1') < 0);
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(compareVersions('1.2.0-beta.1', '1.2.0'), 0);
});

test('classifyKeys flags system combos', () => {
  const r = classifyKeys(['win+r', 'alt+f4', 'ctrl+alt+t', 'rctrl+lalt+x', 'ctrl+s', 'f5']);
  assert.deepEqual(r.dangerous, ['win+r', 'alt+f4', 'ctrl+alt+t', 'rctrl+lalt+x']);
  assert.deepEqual(r.normal, ['ctrl+s', 'f5']);
  assert.ok(!r.canType);
  assert.ok(!r.warning);
});

test('classifyKeys detects shards that can type arbitrary text', () => {
  const letters = 'abcdefghij'.split('');
  assert.ok(!classifyKeys(letters).canType, 'no enter, nothing gets run');
  assert.ok(classifyKeys([...letters, 'enter']).canType);
  assert.ok(!classifyKeys([...letters, 'enter']).warning);
  const r = classifyKeys(['win+r', ...letters, 'shift+a', 'enter']);
  assert.ok(r.canType);
  assert.ok(r.warning, 'win+r plus typing plus enter can run any command');
});
