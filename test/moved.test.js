const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { MOVED, validMoved, firstPending, offered } = require('../moved');
const { ShardStore } = require('../shard-store');
const { makeShardDir } = require('./helpers');

test('the moved shards are no longer bundled', () => {
  const bundled = fs.readdirSync(path.join(__dirname, '..', 'shards'));
  for (const { id } of MOVED) assert.ok(!bundled.includes(id), id);
});

test('everyone who used LibreShard before is offered each moved shard, except the ones they had disabled', () => {
  assert.deepEqual(firstPending({ existingUser: false, state: {} }), [], 'a new install shows nothing');
  assert.deepEqual(firstPending({ existingUser: true, state: {} }), ['obs', 'edicion-imagen'], 'used from the tablet: no trace, still offered');
  assert.deepEqual(firstPending({ existingUser: true, state: { obs: { disabled: true }, 'edicion-imagen': { favorite: true } } }), ['edicion-imagen']);
  assert.deepEqual(firstPending({ existingUser: true, state: undefined }), ['obs', 'edicion-imagen']);
});

test('the notice offers what is pending and not installed again, with the name the user knew', () => {
  const installed = new Set(['edicion-imagen']);
  assert.deepEqual(offered(['obs', 'edicion-imagen'], (id) => installed.has(id)), [{ id: 'obs', name: 'Stream Control', was: 'OBS Studio' }]);
  assert.deepEqual(offered([], () => false), []);
});

test('the saved answer is null or a list of moved ids', () => {
  for (const ok of [null, { pending: [] }, { pending: ['obs'] }, { pending: ['obs', 'edicion-imagen'] }]) assert.equal(validMoved(ok), true, JSON.stringify(ok));
  for (const bad of [undefined, [], { pending: ['desarrollo'] }, { pending: 'obs' }, {}, 'obs']) assert.equal(validMoved(bad), false, JSON.stringify(bad));
});

test('a moved shard installed from the gallery gets back the favorite, place, settings and rules the user had', () => {
  const settings = [{ id: 'scenes', type: 'number', label: 'Scenes', default: 4, min: 0, max: 6 }];
  const manifest = (name) => ({ id: 'obs', name, version: '1.1.0', permissions: { keys: ['ctrl+shift+f18'] }, settings });
  const bundled = makeShardDir({ obs: { manifest: manifest('OBS Studio') } });
  const gallery = makeShardDir({ obs: { manifest: manifest('Stream Control') } });
  const user = fs.mkdtempSync(path.join(os.tmpdir(), 'libreshard-user-'));
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'libreshard-moved-'));
  const opts = { installDir: user, stateFile: path.join(data, 'shards-state.json'), rulesFile: path.join(data, 'app-rules.json') };
  try {
    // 0.5.1: bundled, with the user's favorite, settings and app rule
    const before = new ShardStore({ dirs: [{ dir: bundled, bundled: true }, { dir: user, bundled: false }], ...opts });
    before.setFavorite('obs', true);
    before.setSettings('obs', { scenes: 6 });
    before.setRule('obs', { mode: 'only', apps: [{ exe: 'game.exe' }] });
    assert.equal(before.get('obs').allowed.size, 1, 'bundled: approved as it is');

    // 0.5.2: the app no longer has it; what was saved for it stays
    const after = new ShardStore({ dirs: [{ dir: user, bundled: false }], ...opts });
    assert.equal(after.get('obs'), null);
    assert.equal(after.state.obs.favorite, true);

    const e = after.install(path.join(gallery, 'obs'), { id: 'obs', keys: ['ctrl+shift+f18'] }, { source: { kind: 'gallery', id: 'obs' } });
    assert.equal(e.manifest.name, 'Stream Control');
    assert.equal(after.isFavorite('obs'), true);
    assert.equal(e.settings.scenes, 6);
    assert.equal(e.customApps, true);
    assert.deepEqual(after.sourceOf('obs'), { kind: 'gallery', id: 'obs' });
    assert.deepEqual([...e.allowed], ['ctrl+shift+f18'], 'approved by the install review');
  } finally {
    for (const d of [bundled, gallery, user, data]) fs.rmSync(d, { recursive: true, force: true });
  }
});
