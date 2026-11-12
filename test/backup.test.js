const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ShardStore, cleanRule } = require('../shard-store');
const { validateManifest } = require('../manifest');
const { createBackup, readBackup, checkBackup, writeZip } = require('../backup');
const { makeShardDir } = require('./helpers');
const { makeZip } = require('./zip');

// The app's settings as main.js declares them, enough for the checks
const SETTINGS = {
  port: { valid: (v) => Number.isInteger(v) && v >= 1024 && v <= 65535 },
  confirmDevices: { valid: (v) => typeof v === 'boolean' },
  language: { valid: (v) => ['auto', 'es', 'en'].includes(v) },
  panelBounds: { internal: true, valid: () => true },
};

const schema = [{ id: 'mode', type: 'select', label: 'Mode', options: ['a', 'b'] }, { id: 'on', type: 'toggle', label: 'On', default: true }];

// A PC with a bundled shard, an installed one (with a subfolder) and saved state, rules and settings
function pc() {
  const bundled = makeShardDir({ media: { manifest: { id: 'media', name: 'Media', permissions: { keys: ['playpause'] }, settings: schema } } });
  const user = makeShardDir({ mine: { manifest: { id: 'mine', name: 'Mine', version: '1.2.0', permissions: { keys: ['f13'] }, settings: schema }, files: { 'style.css': 'b{}' } } });
  fs.mkdirSync(path.join(user, 'mine', 'img'));
  fs.writeFileSync(path.join(user, 'mine', 'img', 'logo.svg'), '<svg/>');
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'libreshard-backup-'));
  const store = new ShardStore({
    dirs: [{ dir: bundled, bundled: true }, { dir: user, bundled: false }],
    installDir: user,
    stateFile: path.join(data, 'shards-state.json'),
    rulesFile: path.join(data, 'app-rules.json'),
  });
  const cleanup = () => [bundled, user, data].forEach((d) => fs.rmSync(d, { recursive: true, force: true }));
  return { store, user, data, cleanup };
}

test('a backup holds settings, rules, shard states and installed shards, and reads back the same', async () => {
  const a = pc();
  a.store.approve('mine');
  a.store.restoreState('mine', { favorite: true, position: 3, settings: { mode: 'b' } });
  a.store.restoreState('media', { disabled: true });
  const rules = { mine: { mode: 'only', apps: [{ exe: 'game.exe' }] } };
  const zip = createBackup({
    appVersion: '0.3.0', config: { port: 7900, confirmDevices: true, language: 'es' }, rules,
    state: a.store.state, shards: a.store.all(), now: new Date('2026-11-12T10:00:00Z'),
  });
  const file = path.join(a.data, 'backup.zip');
  fs.writeFileSync(file, zip);

  const r = await readBackup(file, { settings: SETTINGS });
  try {
    assert.ok(r.ok, r.errors && r.errors.join());
    assert.deepEqual(r.data.config, { port: 7900, confirmDevices: true, language: 'es' });
    assert.deepEqual(r.data.appRules, { mine: { mode: 'only', apps: cleanRule(rules.mine).apps } });
    assert.deepEqual(r.data.shards, { mine: { favorite: true, position: 3, settings: { mode: 'b' } }, media: { disabled: true } });
    assert.deepEqual(r.data.installed, ['mine'], 'only the shards the user installed, never bundled ones');
    assert.equal(r.data.appVersion, '0.3.0');
    assert.equal(r.data.createdAt, '2026-11-12T10:00:00.000Z');
    // The installed shard's files, subfolders included
    for (const f of ['manifest.json', 'index.html', 'style.css', 'img/logo.svg']) assert.ok(fs.existsSync(path.join(r.shardDir('mine'), f)), f);
    const raw = fs.readFileSync(path.join(r.dir, 'backup.json'), 'utf8');
    assert.ok(!raw.includes('approved'), 'key approvals are never saved');
  } finally {
    r.cleanup();
    a.cleanup();
  }
  assert.ok(!fs.existsSync(r.dir), 'the extracted copy is removed');
});

test('development links are not copied into a backup', () => {
  const a = pc();
  const dev = makeShardDir({ devshard: { manifest: { id: 'devshard', permissions: { keys: ['f15'] } } } });
  try {
    const { manifest } = validateManifest(JSON.parse(fs.readFileSync(path.join(dev, 'devshard', 'manifest.json'))));
    a.store.link(path.join(dev, 'devshard'), manifest);
    const zip = createBackup({ appVersion: '0.3.0', config: {}, rules: {}, state: a.store.state, shards: a.store.all() });
    assert.ok(!zip.includes(Buffer.from('shards/devshard/')));
    assert.ok(zip.includes(Buffer.from('shards/mine/')));
  } finally {
    fs.rmSync(dev, { recursive: true, force: true });
    a.cleanup();
  }
});

test('reading trusts nothing: unknown, internal or invalid values are dropped', () => {
  const r = checkBackup({
    app: 'LibreShard', format: 1, appVersion: 'x'.repeat(100), createdAt: 'yesterday',
    config: { port: 80, confirmDevices: 'yes', language: 'en', panelBounds: { x: 1 }, devices: [{ token: 'x' }], approved: ['f13'] },
    appRules: { mine: { mode: 'only', apps: ['notepad'] }, '../evil': { mode: 'any' }, bad: { mode: 'sometimes' } },
    shards: { mine: { disabled: 'no', favorite: true, position: -1, settings: { mode: 'b' }, approved: ['ctrl+alt+del'] }, 'Bad Id': {} },
    installed: ['mine', '../../etc', 42, 'mine'],
  }, SETTINGS);
  assert.ok(r.ok);
  assert.deepEqual(r.data.config, { language: 'en' });
  assert.deepEqual(r.data.appRules, { mine: { mode: 'only', apps: [{ match: 'notepad' }] } });
  assert.deepEqual(r.data.shards, { mine: { favorite: true, settings: { mode: 'b' } } });
  assert.deepEqual(r.data.installed, ['mine']);
  assert.equal(r.data.appVersion.length, 40);
  assert.equal(r.data.createdAt, null);
});

test('files that are not LibreShard backups, or come from a newer version, are refused', async () => {
  assert.deepEqual(checkBackup({ hello: 1 }, SETTINGS).errors, ['This is not a LibreShard backup']);
  assert.match(checkBackup({ app: 'LibreShard', format: 2 }, SETTINGS).errors[0], /newer/);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'libreshard-backup-'));
  try {
    const noJson = path.join(dir, 'a.zip');
    fs.writeFileSync(noJson, writeZip([{ name: 'readme.txt', data: Buffer.from('hi') }]));
    assert.deepEqual((await readBackup(noJson, { settings: SETTINGS })).errors, ['This is not a LibreShard backup']);

    // A hostile zip never gets past the installer's extraction
    const evil = path.join(dir, 'b.zip');
    fs.writeFileSync(evil, makeZip([{ name: 'backup.json', data: '{}' }, { name: '../escape.txt', data: 'x' }]));
    await assert.rejects(readBackup(evil, { settings: SETTINGS }), /Unsafe path|invalid relative path/);

    // A shard listed as installed but missing from the zip is left out
    const missing = path.join(dir, 'c.zip');
    fs.writeFileSync(missing, writeZip([{ name: 'backup.json', data: Buffer.from(JSON.stringify({ app: 'LibreShard', format: 1, installed: ['ghost'] })) }]));
    const r = await readBackup(missing, { settings: SETTINGS });
    assert.deepEqual(r.data.installed, []);
    r.cleanup();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('restoring a shard state drops settings its manifest does not accept, and never approves keys', () => {
  const a = pc();
  try {
    assert.equal(a.store.get('mine').allowed.size, 0, 'installed by hand, not approved yet');
    a.store.restoreState('mine', { favorite: true, settings: { mode: 'z', on: false, ghost: 1 } });
    assert.deepEqual(a.store.get('mine').settings, { mode: 'a', on: false });
    assert.equal(a.store.isFavorite('mine'), true);
    assert.equal(a.store.get('mine').allowed.size, 0);
    a.store.restoreState('mine', {});
    assert.equal(a.store.isFavorite('mine'), false);
  } finally {
    a.cleanup();
  }
});
