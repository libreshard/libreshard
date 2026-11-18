const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ShardStore } = require('../shard-store');
const { makeShardDir } = require('./helpers');
const { buildShard, copyOfPanel, isOwnPanel } = require('../panel-format');
const { validateManifest } = require('../manifest');

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

// Watchers start asynchronously: fs.watchFile takes its first stat later, and FSEvents (macOS)
// ignores what happened before its stream started. A write made right after watching can be
// missed on a slow machine, so the watch tests give the watchers a moment first.
const settle = () => new Promise((r) => setTimeout(r, 1000));

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

test('installing over an installed shard keeps its favorite, position, disabled state and settings', () => {
  const t = setup();
  const settings = [{ id: 'mode', type: 'select', label: 'Mode', options: ['a', 'b'] }];
  const src = makeShardDir({ v2: { manifest: { id: 'mine', version: '2.0.0', ...keys('f13', 'f16'), settings } } });
  try {
    fs.writeFileSync(path.join(t.user, 'mine', 'manifest.json'), JSON.stringify({ id: 'mine', ...keys('f13'), settings }));
    const s = t.make();
    s.approve('mine');
    s.setFavorite('mine', true);
    s.setEnabled('mine', false);
    s.setSettings('mine', { mode: 'b' });
    s.move('media', 1);
    const before = { ...s.state.mine };
    s.install(path.join(src, 'v2'), { id: 'mine', keys: ['f13', 'f16'] });
    assert.deepEqual(s.state.mine, { ...before, approved: ['f13', 'f16'] });
    const e = t.make().mustGet('mine'); // get() hides disabled shards
    assert.equal(e.manifest.version, '2.0.0');
    assert.equal(e.enabled, false);
    assert.deepEqual(e.settings, { mode: 'b' });
    assert.deepEqual(e.pendingKeys, []);
  } finally {
    t.cleanup();
    fs.rmSync(src, { recursive: true, force: true });
  }
});

test('install saves where a shard came from, keeps it on a plain reinstall, and trusts only its shape', () => {
  const t = setup();
  const src = makeShardDir({ v1: { manifest: { id: 'web', ...keys('f13') } } });
  try {
    const s = t.make();
    s.install(path.join(src, 'v1'), { id: 'web', keys: ['f13'] }, { source: { kind: 'url', host: 'autor.itch.io' } });
    assert.deepEqual(s.sourceOf('web'), { kind: 'url', host: 'autor.itch.io' });
    s.install(path.join(src, 'v1'), { id: 'web', keys: ['f13'] });
    assert.deepEqual(t.make().sourceOf('web'), { kind: 'url', host: 'autor.itch.io' }, 'a reinstall from a file keeps it');
    s.install(path.join(src, 'v1'), { id: 'web', keys: ['f13'] }, { source: { kind: 'gallery', id: 'web' } });
    assert.deepEqual(s.sourceOf('web'), { kind: 'gallery', id: 'web' });
    for (const bad of [{ kind: 'url', host: 'x y' }, { kind: 'other', host: 'a.com' }, 'a.com', { kind: 'url' }, { kind: 'gallery', id: 'Bad Id' }]) {
      s.state.web.source = bad;
      assert.equal(s.sourceOf('web'), null, JSON.stringify(bad));
    }
    assert.equal(s.sourceOf('media'), null);
  } finally {
    t.cleanup();
    fs.rmSync(src, { recursive: true, force: true });
  }
});

test('editor and file sources are saved like the others; extra fields are dropped and bad ones refused', () => {
  const t = setup();
  const src = makeShardDir({ v1: { manifest: { id: 'own', ...keys('f13') } } });
  try {
    const s = t.make();
    assert.equal(s.sourceOf('mine'), null, 'copied by hand or installed before 0.5.1: no source');
    s.install(path.join(src, 'v1'), { id: 'own', keys: ['f13'] }, { source: { kind: 'file' } });
    assert.deepEqual(s.sourceOf('own'), { kind: 'file' });
    s.install(path.join(src, 'v1'), { id: 'own', keys: ['f13'] }, { source: { kind: 'editor', host: 'x.com', id: 'y' } });
    assert.deepEqual(t.make().sourceOf('own'), { kind: 'editor' }, 'saved, and only its kind');
    assert.throws(() => s.install(path.join(src, 'v1'), { id: 'own', keys: ['f13'] }, { source: { kind: 'Editor' } }), /Invalid source/);
    for (const bad of [{ kind: 'EDITOR' }, { kind: 'files' }, ['editor'], 'file', { kind: 'editor ' }]) {
      s.state.own.source = bad;
      assert.equal(s.sourceOf('own'), null, JSON.stringify(bad));
    }
  } finally {
    t.cleanup();
    fs.rmSync(src, { recursive: true, force: true });
  }
});

test('a copy remembers the shard and version it came from, and keeps the original panel.json outside the shard folders', () => {
  const t = setup();
  try {
    const originals = path.join(t.data, 'panel-originals');
    const s = t.make({ originalsDir: originals });
    const original = Buffer.from('{ "format": 1, "pages": [] }\n');
    s.setCopiedFrom('mine', { id: 'office', version: '1.2.0' }, original);
    assert.deepEqual(s.copiedFromOf('mine'), { id: 'office', version: '1.2.0' });
    const file = s.originalFile('mine');
    assert.equal(path.dirname(file), originals);
    assert.ok(path.relative(t.user, file).startsWith('..'), 'never inside the folder served to the tablets');
    assert.deepEqual(fs.readFileSync(file), original, 'kept byte for byte');
    assert.deepEqual(t.make({ originalsDir: originals }).copiedFromOf('mine'), { id: 'office', version: '1.2.0' }, 'saved in shards-state.json');
    s.setCopiedFrom('mine', { id: 'office', version: null }, original);
    assert.deepEqual(s.copiedFromOf('mine'), { id: 'office', version: null }, 'an original without a version');
    for (const bad of [{ id: 'Office', version: '1' }, { id: 'office' }, { id: 'office', version: 3 }, { id: 'office', version: 'x'.repeat(21) }, 'office']) {
      assert.throws(() => s.setCopiedFrom('mine', bad, original), /Invalid copiedFrom/, JSON.stringify(bad));
      s.state.mine.copiedFrom = bad;
      assert.equal(s.copiedFromOf('mine'), null, JSON.stringify(bad));
    }
    assert.throws(() => s.setCopiedFrom('mine', { id: 'office', version: '1' }, ''), /original/);
    assert.throws(() => t.make().setCopiedFrom('mine', { id: 'office', version: '1' }, original), /No folder/);
    assert.equal(s.originalFile('../x'), null);
  } finally { t.cleanup(); }
});

test('uninstalling a copy removes what it remembered and its original panel.json', () => {
  const t = setup();
  try {
    const s = t.make({ originalsDir: path.join(t.data, 'panel-originals') });
    s.setCopiedFrom('mine', { id: 'office', version: '1.2.0' }, '{}');
    const file = s.originalFile('mine');
    assert.ok(fs.existsSync(file));
    s.uninstall('mine');
    assert.ok(!fs.existsSync(file));
    assert.equal(s.copiedFromOf('mine'), null);
    assert.equal(s.state.mine, undefined);
  } finally { t.cleanup(); }
});

test('a shard restored from a backup gets back its source and, with its original panel.json, what it was copied from', () => {
  const t = setup();
  const again = makeShardDir({ mine: { manifest: { id: 'mine', ...keys('f13') } } });
  try {
    const s = t.make({ originalsDir: path.join(t.data, 'panel-originals') });
    s.restoreOrigin('mine', { source: { kind: 'editor' }, copiedFrom: { id: 'office', version: '1.2.0' } }, Buffer.from('{}'));
    assert.deepEqual(s.sourceOf('mine'), { kind: 'editor' });
    assert.deepEqual(s.copiedFromOf('mine'), { id: 'office', version: '1.2.0' });
    s.uninstall('mine');
    s.install(path.join(again, 'mine'), { id: 'mine', keys: ['f13'] });
    s.restoreOrigin('mine', { source: { kind: 'nope' }, copiedFrom: { id: 'office', version: '1.2.0' } }, null);
    assert.equal(s.sourceOf('mine'), null, 'an invalid source is left out');
    assert.equal(s.copiedFromOf('mine'), null, 'never without its original panel.json');
    s.restoreOrigin('mine', undefined, null);
    assert.equal(s.sourceOf('mine'), null);
  } finally {
    t.cleanup();
    fs.rmSync(again, { recursive: true, force: true });
  }
});

test("saving someone else's panel creates a copy of the user's own and leaves the original as it was", () => {
  const t = setup();
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'libreshard-copy-'));
  // What editor:save does in main.js, with the same functions
  const save = (s, { panel, meta }, opts) => {
    const built = buildShard({ panel, meta });
    const dir = path.join(src, built.manifest.id + '-' + built.manifest.version);
    fs.mkdirSync(dir);
    for (const [f, content] of Object.entries(built.files)) fs.writeFileSync(path.join(dir, f), content);
    const checked = validateManifest(built.manifest, { appVersion: '0.5.1' });
    assert.ok(checked.ok, checked.errors && checked.errors.join());
    s.install(dir, checked.manifest, opts);
    return checked.manifest;
  };
  try {
    const s = t.make({ originalsDir: path.join(t.data, 'panel-originals') });
    const panel = { format: 1, grid: { cols: 2, rows: 1 }, pages: [{ id: 'p1', name: 'Main', layout: 'grid', buttons: [{ id: 'b', col: 0, row: 0, w: 1, h: 1, type: 'press', key: 'f13' }] }] };
    const meta = { id: 'office', name: 'Office', author: 'Ana', description: 'Shortcuts', license: 'Apache-2.0', url: 'https://ana.example/office', apps: ['winword.exe'] };
    // The original, from the gallery (saving raises 1.1.0 to 1.1.1), with the user's favorite
    const original = save(s, { panel, meta: { ...meta, version: '1.1.0' } }, { source: { kind: 'gallery', id: 'office' } });
    assert.equal(original.version, '1.1.1');
    s.setFavorite('office', true);
    const originalPanel = fs.readFileSync(path.join(t.user, 'office', 'panel.json'));
    assert.equal(isOwnPanel(s.sourceOf('office')), false);

    // Opened in the editor: a copy with a new name and no id; saved: a new shard
    const c = copyOfPanel({ id: 'office', meta: { ...meta, version: original.version }, format: (n) => `${n} (copia)` });
    assert.equal(c.meta.version, undefined);
    const changed = { ...panel, grid: { cols: 3, rows: 1 } };
    const copy = save(s, { panel: changed, meta: { ...c.meta, id: undefined } }, { source: { kind: 'editor' } });
    s.setCopiedFrom(copy.id, c.copiedFrom, originalPanel);
    assert.match(copy.id, /^panel-office-copia-[0-9a-f]{4}$/);
    assert.deepEqual([copy.name, copy.version, copy.author, copy.license, copy.url, copy.description], ['Office (copia)', '1.0.0', 'Ana', 'Apache-2.0', 'https://ana.example/office', 'Shortcuts']);
    assert.deepEqual(s.sourceOf(copy.id), { kind: 'editor' });
    assert.equal(isOwnPanel(s.sourceOf(copy.id)), true);
    assert.deepEqual(s.copiedFromOf(copy.id), { id: 'office', version: '1.1.1' });
    assert.deepEqual(fs.readFileSync(s.originalFile(copy.id)), originalPanel);
    assert.equal(s.get(copy.id).allowed.has('f13'), true, 'its keys are approved: the user saved them here');

    // The original: same files, version, source and favorite
    assert.deepEqual(fs.readFileSync(path.join(t.user, 'office', 'panel.json')), originalPanel);
    assert.equal(s.get('office').manifest.version, '1.1.1');
    assert.deepEqual(s.sourceOf('office'), { kind: 'gallery', id: 'office' });
    assert.equal(s.isFavorite('office'), true);
    assert.equal(s.copiedFromOf('office'), null);

    // Saving the copy again: in place, a new patch version, still a copy of the same original
    const again = save(s, { panel: changed, meta: { ...c.meta, id: copy.id, version: copy.version } }, { source: { kind: 'editor' } });
    assert.deepEqual([again.id, again.version], [copy.id, '1.0.1']);
    assert.deepEqual(s.copiedFromOf(copy.id), { id: 'office', version: '1.1.1' });
    assert.equal(s.all().length, 4, 'media, mine, the original and one copy');
  } finally {
    t.cleanup();
    fs.rmSync(src, { recursive: true, force: true });
  }
});

test('a user shard with panel.json is a panel; bundled and linked ones never are', () => {
  const t = setup();
  const dev = makeShardDir({ devpanel: { manifest: { id: 'devpanel', ...keys('f13') }, files: { 'panel.json': '{}' } } });
  try {
    fs.writeFileSync(path.join(t.user, 'mine', 'panel.json'), '{}');
    fs.writeFileSync(path.join(t.bundled, 'media', 'panel.json'), '{}');
    fs.symlinkSync(path.join(dev, 'devpanel'), path.join(t.user, 'devpanel'), 'junction');
    const s = t.make();
    assert.equal(s.get('mine').panel, true);
    assert.equal(s.get('media').panel, false);
    assert.equal(s.get('devpanel').panel, false);
  } finally {
    t.cleanup();
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
    await settle();
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
    await settle();
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
    await settle();
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

