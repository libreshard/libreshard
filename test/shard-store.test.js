const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ShardStore } = require('../shard-store');
const { makeShardDir } = require('./helpers');

const keys = (...k) => ({ permissions: { keys: k } });

// A fresh bundled dir + user dir + state file for each test
function setup() {
  const bundled = makeShardDir({ media: { manifest: { id: 'media', name: 'Media', ...keys('playpause') } } });
  const user = makeShardDir({ mine: { manifest: { id: 'mine', name: 'Mine', version: '1.0.0', ...keys('f13', 'f14') } } });
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'libreshard-state-'));
  const make = (opts = {}) => new ShardStore({
    dirs: [{ dir: bundled, bundled: true }, { dir: user, bundled: false }],
    installDir: user,
    stateFile: path.join(data, 'shards-state.json'),
    ...opts,
  });
  const cleanup = () => [bundled, user, data].forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  return { bundled, user, data, make, cleanup };
}

// Resolves once check() is true, looking again on every 'change'. The first 'change' after a write
// isn't necessarily that write: macOS can deliver earlier file events late.
function changed(store, check, ms = 5000) {
  return new Promise((resolve, reject) => {
    const done = (err) => { clearTimeout(timer); store.off('change', on); err ? reject(err) : resolve(); };
    const on = () => { if (check()) done(); };
    const timer = setTimeout(() => done(new Error('no matching change within ' + ms + ' ms')), ms);
    store.on('change', on);
  });
}

test('bundled shards are approved; user shards wait for approval', () => {
  const t = setup();
  try {
    const s = t.make();
    assert.deepEqual([...s.get('media').allowed], ['playpause']);
    assert.deepEqual([...s.get('mine').allowed], []);
    assert.deepEqual(s.get('mine').pendingKeys, ['f13', 'f14']);
    assert.deepEqual(s.publicList().map((e) => [e.id, e.pending]), [['media', false], ['mine', true]]);

    s.approve('mine');
    assert.deepEqual([...s.get('mine').allowed], ['f13', 'f14']);
    assert.equal(t.make().get('mine').pendingKeys.length, 0, 'approval is saved');
  } finally { t.cleanup(); }
});

test('keys added to a manifest after approval stay blocked until approved again', () => {
  const t = setup();
  try {
    const s = t.make();
    s.approve('mine');
    fs.writeFileSync(path.join(t.user, 'mine', 'manifest.json'), JSON.stringify({ id: 'mine', ...keys('f13', 'f14', 'win+r') }));
    s.load();
    assert.deepEqual([...s.get('mine').allowed], ['f13', 'f14']);
    assert.deepEqual(s.get('mine').pendingKeys, ['win+r']);
  } finally { t.cleanup(); }
});

test('disabled shards are not served but stay listed for the PC', () => {
  const t = setup();
  try {
    const s = t.make();
    s.setEnabled('media', false);
    assert.equal(s.get('media'), null);
    assert.ok(!s.publicList().some((e) => e.id === 'media'));
    assert.ok(s.all().some((e) => e.id === 'media' && !e.enabled));
    assert.equal(t.make().get('media'), null, 'saved');
    s.setEnabled('media', true);
    assert.ok(s.get('media'));
  } finally { t.cleanup(); }
});

test('install copies the shard under its id, approves it and skips links', () => {
  const t = setup();
  const src = makeShardDir({ 'any-name': { manifest: { id: 'new-one', version: '1.0.0', ...keys('f15') }, files: { 'a.css': 'x' } } });
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'libreshard-out-'));
  try {
    fs.symlinkSync(outside, path.join(src, 'any-name', 'link'), 'junction');
    const s = t.make();
    const changes = [];
    s.on('change', () => changes.push(1));
    const entry = s.install(path.join(src, 'any-name'), { id: 'new-one', keys: ['f15'] });
    assert.equal(entry.root, path.join(t.user, 'new-one'));
    assert.ok(fs.existsSync(path.join(t.user, 'new-one', 'a.css')));
    assert.ok(!fs.existsSync(path.join(t.user, 'new-one', 'link')), 'links are not copied');
    assert.deepEqual([...s.get('new-one').allowed], ['f15']);
    assert.equal(changes.length, 1);
  } finally {
    t.cleanup();
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('install replaces an installed copy but refuses bundled and linked ids', () => {
  const t = setup();
  const src = makeShardDir({
    v2: { manifest: { id: 'mine', version: '2.0.0', ...keys('f13') }, files: { 'new.txt': 'v2' } },
    clash: { manifest: { id: 'media', ...keys('f13') } },
  });
  const dev = makeShardDir({ devshard: { manifest: { id: 'devshard', ...keys('f13') } } });
  try {
    fs.symlinkSync(path.join(dev, 'devshard'), path.join(t.user, 'devshard'), 'junction');
    const s = t.make();
    s.install(path.join(src, 'v2'), { id: 'mine', keys: ['f13'] });
    assert.equal(s.get('mine').manifest.version, '2.0.0');
    assert.ok(fs.existsSync(path.join(t.user, 'mine', 'new.txt')));
    assert.throws(() => s.install(path.join(src, 'clash'), { id: 'media', keys: ['f13'] }), /bundled/);
    assert.throws(() => s.install(path.join(src, 'v2'), { id: 'devshard', keys: ['f13'] }), /linked/);
  } finally {
    t.cleanup();
    fs.rmSync(src, { recursive: true, force: true });
    fs.rmSync(dev, { recursive: true, force: true });
  }
});

test('uninstalling a linked shard removes only the link, never the folder it points to', () => {
  const t = setup();
  const dev = makeShardDir({ devshard: { manifest: { id: 'devshard', ...keys('f13') }, files: { 'work.js': 'precious' } } });
  try {
    fs.symlinkSync(path.join(dev, 'devshard'), path.join(t.user, 'devshard'), 'junction');
    const s = t.make();
    assert.ok(s.all().find((e) => e.id === 'devshard').linked);
    s.uninstall('devshard');
    assert.ok(!fs.existsSync(path.join(t.user, 'devshard')));
    assert.equal(fs.readFileSync(path.join(dev, 'devshard', 'work.js'), 'utf8'), 'precious');
  } finally {
    t.cleanup();
    fs.rmSync(dev, { recursive: true, force: true });
  }
});

test('uninstalling a copied shard never follows links inside it', () => {
  const t = setup();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'libreshard-out-'));
  try {
    fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
    fs.symlinkSync(outside, path.join(t.user, 'mine', 'escape'), 'junction');
    const s = t.make();
    s.uninstall('mine');
    assert.ok(!fs.existsSync(path.join(t.user, 'mine')));
    assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
  } finally {
    t.cleanup();
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('bundled shards cannot be uninstalled', () => {
  const t = setup();
  try {
    assert.throws(() => t.make().uninstall('media'), /Bundled/);
  } finally { t.cleanup(); }
});

test('watching reloads when a shard folder appears in the user folder', async () => {
  const t = setup();
  const s = t.make({ watch: true });
  try {
    const appeared = changed(s, () => s.all().some((e) => e.id === 'dropped'));
    const dir = path.join(t.user, 'dropped');
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, 'index.html'), 'x');
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ id: 'dropped', ...keys('f13') }));
    await appeared;
    assert.ok(s.all().some((e) => e.id === 'dropped'));
  } finally {
    s.close();
    t.cleanup();
  }
});

test('app rules reload on their own when watching', async () => {
  const t = setup();
  const rulesFile = path.join(t.data, 'rules.json');
  fs.writeFileSync(rulesFile, '{}');
  const s = t.make({ rulesFile, watch: true });
  try {
    assert.deepEqual(s.get('media').apps, []);
    const reloaded = changed(s, () => s.get('media').apps.length > 0);
    fs.writeFileSync(rulesFile, JSON.stringify({ media: { mode: 'only', apps: [{ match: 'spotify' }] } }));
    await reloaded;
    assert.deepEqual(s.get('media').apps, [{ match: 'spotify' }]);
  } finally {
    s.close();
    t.cleanup();
  }
});

/* ---------- App rules ---------- */

test('rules that are not { mode } objects are ignored: the manifest apps apply', () => {
  const t = setup();
  const rulesFile = path.join(t.data, 'rules.json');
  fs.writeFileSync(rulesFile, JSON.stringify({ media: ['spotify'], mine: 'krita' }));
  try {
    const s = t.make({ rulesFile });
    assert.equal(s.get('media').customApps, false);
    assert.equal(s.get('mine').customApps, false);
  } finally { t.cleanup(); }
});

test('setRule writes the new format, keeps other rules and applies at once', () => {
  const t = setup();
  const rulesFile = path.join(t.data, 'rules.json');
  fs.writeFileSync(rulesFile, JSON.stringify({ 'someone-else': ['krita'] }));
  try {
    const s = t.make({ rulesFile });
    const changes = [];
    s.on('change', () => changes.push(1));
    s.setRule('media', { mode: 'only', apps: [{ exe: 'C:\\Music\\Spotify.exe', name: 'Spotify', path: 'C:\\Music\\Spotify.exe' }, 'vlc', { bogus: 1 }] });
    assert.deepEqual(s.get('media').apps, [{ exe: 'Spotify.exe', name: 'Spotify', path: 'C:\\Music\\Spotify.exe' }, { match: 'vlc' }]);
    assert.equal(changes.length, 1);
    const saved = JSON.parse(fs.readFileSync(rulesFile, 'utf8'));
    assert.deepEqual(saved['someone-else'], ['krita'], 'other rules untouched');
    assert.equal(saved.media.mode, 'only');

    s.setRule('media', { mode: 'any' });
    assert.deepEqual(s.get('media').apps, []);
    s.setRule('media', { mode: 'only', apps: [] });
    assert.deepEqual(s.get('media').apps, [], '"only" with nothing usable means any app');
    assert.throws(() => s.setRule('media', { mode: 'sometimes' }), /Invalid/);
    assert.throws(() => s.setRule('nope', { mode: 'any' }), /Unknown shard/);
  } finally { t.cleanup(); }
});

test('resetRule goes back to the apps suggested by the manifest', () => {
  const t = setup();
  const rulesFile = path.join(t.data, 'rules.json');
  try {
    fs.writeFileSync(path.join(t.user, 'mine', 'manifest.json'), JSON.stringify({ id: 'mine', apps: ['photoshop'], ...keys('f13') }));
    const s = t.make({ rulesFile });
    assert.deepEqual(s.get('mine').suggestedApps, [{ match: 'photoshop' }]);
    s.setRule('mine', { mode: 'any' });
    assert.deepEqual(s.get('mine').apps, []);
    s.resetRule('mine');
    assert.deepEqual(s.get('mine').apps, [{ match: 'photoshop' }]);
    assert.equal(s.get('mine').customApps, false);
  } finally { t.cleanup(); }
});

test('addApp adds a detected program once, and never to a shard that already acts everywhere', () => {
  const t = setup();
  const rulesFile = path.join(t.data, 'rules.json');
  try {
    const s = t.make({ rulesFile });
    s.addApp('media', { exe: 'Spotify.exe', name: 'Spotify' });
    assert.deepEqual(s.get('media').apps, [], 'media had no restriction');
    s.setRule('media', { mode: 'only', apps: [{ exe: 'vlc.exe', name: 'VLC' }] });
    s.addApp('media', { exe: 'Spotify.exe', name: 'Spotify' });
    s.addApp('media', { exe: 'spotify.EXE', name: 'Spotify again' });
    assert.deepEqual(s.get('media').apps.map((a) => a.exe), ['vlc.exe', 'Spotify.exe']);
    assert.throws(() => s.addApp('media', { match: 'anything' }), /detected program/);
  } finally { t.cleanup(); }
});

test('a rules file with invalid JSON is never overwritten', () => {
  const t = setup();
  const rulesFile = path.join(t.data, 'rules.json');
  fs.writeFileSync(rulesFile, '{ "media": [ broken');
  try {
    const s = t.make({ rulesFile });
    assert.throws(() => s.setRule('media', { mode: 'any' }), /invalid JSON/);
    assert.equal(fs.readFileSync(rulesFile, 'utf8'), '{ "media": [ broken');
  } finally { t.cleanup(); }
});

/* ---------- Shard settings and development links ---------- */

test('settings are saved, checked against the manifest and announced', () => {
  const t = setup();
  try {
    fs.writeFileSync(path.join(t.user, 'mine', 'manifest.json'), JSON.stringify({
      id: 'mine', ...keys('f13'),
      settings: [{ id: 'mode', type: 'select', label: 'Mode', options: ['a', 'b'] }, { id: 'on', type: 'toggle', label: 'On', default: true }],
    }));
    const s = t.make();
    assert.deepEqual(s.get('mine').settings, { mode: 'a', on: true });
    assert.deepEqual(s.publicList().find((e) => e.id === 'mine').settings, { mode: 'a', on: true });
    const events = [];
    s.on('settings', (id, values) => events.push([id, values]));
    s.setSettings('mine', { mode: 'b' });
    assert.deepEqual(events, [['mine', { mode: 'b', on: true }]]);
    assert.deepEqual(t.make().get('mine').settings, { mode: 'b', on: true }, 'saved');
    assert.throws(() => s.setSettings('mine', { mode: 'z' }), /Invalid value/);
    assert.throws(() => s.setSettings('mine', { other: 1 }), /Unknown setting/);
    s.resetSettings('mine');
    assert.deepEqual(s.get('mine').settings, { mode: 'a', on: true });
  } finally { t.cleanup(); }
});

test('link puts a development folder in place without copying, and approves it', () => {
  const t = setup();
  const dev = makeShardDir({ work: { manifest: { id: 'dev-one', ...keys('f15') }, files: { 'a.js': '1' } } });
  try {
    const s = t.make();
    const e = s.link(path.join(dev, 'work'), { id: 'dev-one', keys: ['f15'] });
    assert.ok(e.linked);
    assert.deepEqual([...e.allowed], ['f15']);
    fs.writeFileSync(path.join(dev, 'work', 'a.js'), '2');
    assert.equal(fs.readFileSync(path.join(t.user, 'dev-one', 'a.js'), 'utf8'), '2', 'same files, not a copy');
    assert.throws(() => s.link(path.join(dev, 'work'), { id: 'dev-one', keys: [] }), /already exists/);
    assert.throws(() => s.link(path.join(dev, 'work'), { id: 'media', keys: [] }), /already exists/);
  } finally {
    t.cleanup();
    fs.rmSync(dev, { recursive: true, force: true });
  }
});

test('editing a linked shard emits "files"; editing its manifest reloads', async () => {
  const t = setup();
  const dev = makeShardDir({ work: { manifest: { id: 'dev-two', ...keys('f15') } } });
  const s = t.make({ watch: true });
  try {
    s.link(path.join(dev, 'work'), { id: 'dev-two', keys: ['f15'] });
    const files = new Promise((r) => s.once('files', r));
    fs.writeFileSync(path.join(dev, 'work', 'style.css'), 'body{}');
    assert.equal(await files, 'dev-two');

    const reloaded = changed(s, () => (s.get('dev-two')?.pendingKeys || []).includes('f16'));
    fs.writeFileSync(path.join(dev, 'work', 'manifest.json'), JSON.stringify({ id: 'dev-two', ...keys('f15', 'f16') }));
    await reloaded;
    assert.deepEqual(s.get('dev-two').pendingKeys, ['f16'], 'new keys still need approval');
  } finally {
    s.close();
    t.cleanup();
    fs.rmSync(dev, { recursive: true, force: true });
  }
});

/* ---------- Menu order and favorites ---------- */

test('the menu is sorted by name until the user orders it, and favorites always come first', () => {
  const t = setup();
  const extra = makeShardDir({
    a: { manifest: { id: 'alpha', name: 'Alpha', ...keys('f13') } },
    z: { manifest: { id: 'zulu', name: 'Zulu', ...keys('f13') } },
  });
  try {
    const s = new ShardStore({
      dirs: [{ dir: t.bundled, bundled: true }, { dir: t.user, bundled: false }, { dir: extra, bundled: false }],
      installDir: t.user,
      stateFile: path.join(t.data, 'shards-state.json'),
    });
    const order = () => s.all().map((e) => e.id).join(',');
    assert.equal(order(), 'alpha,media,mine,zulu');

    s.move('zulu', -1);
    assert.equal(order(), 'alpha,media,zulu,mine');
    s.move('alpha', -1);
    assert.equal(order(), 'alpha,media,zulu,mine', 'the first one cannot go higher');

    s.setFavorite('mine', true);
    assert.equal(order(), 'mine,alpha,media,zulu');
    assert.deepEqual(s.publicList().filter((e) => e.favorite).map((e) => e.id), ['mine']);
    s.move('alpha', -1);
    assert.equal(order(), 'mine,alpha,media,zulu', 'a shard never jumps into the favorites group');
    s.move('mine', 1);
    assert.equal(order(), 'mine,alpha,media,zulu', 'nor out of it');

    const reloaded = new ShardStore({
      dirs: [{ dir: t.bundled, bundled: true }, { dir: t.user, bundled: false }, { dir: extra, bundled: false }],
      installDir: t.user,
      stateFile: path.join(t.data, 'shards-state.json'),
    });
    assert.equal(reloaded.all().map((e) => e.id).join(','), 'mine,alpha,media,zulu', 'saved');

    s.setFavorite('mine', false);
    assert.equal(order(), 'alpha,media,zulu,mine');
    assert.throws(() => s.move('alpha', 2), /Direction/);
    assert.throws(() => s.setFavorite('nope', true), /Unknown shard/);
  } finally {
    t.cleanup();
    fs.rmSync(extra, { recursive: true, force: true });
  }
});

