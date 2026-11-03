const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { migrateData } = require('../migrate');

function appData() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'libreshard-migrate-'));
}

function writeOld(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
}

test('copies every data file and the user shards from the LibrePad folder', () => {
  const root = appData();
  const old = path.join(root, 'LibrePad');
  writeOld(old, {
    'config.json': '{"port":7878}',
    'devices.json': '[{"id":"a"}]',
    'shards-state.json': '{"mine":{"approved":["f13"]}}',
    'app-rules.json': '{}',
    'shards/mine/manifest.json': '{"id":"mine"}',
    'Local Storage/leveldb/LOCK': '',
  });
  const data = path.join(root, 'LibreShard');
  assert.equal(migrateData(root, data), old);
  for (const f of ['config.json', 'devices.json', 'shards-state.json', 'app-rules.json', 'shards/mine/manifest.json']) {
    assert.equal(fs.readFileSync(path.join(data, f), 'utf8'), fs.readFileSync(path.join(old, f), 'utf8'), f);
  }
  assert.equal(fs.existsSync(path.join(data, 'Local Storage')), false, 'browser storage stays behind');
  assert.ok(fs.existsSync(path.join(old, 'config.json')), 'the old folder is left as it was');
});

test('a development shard stays a link to the same folder, not a copy', () => {
  const root = appData();
  const dev = path.join(root, 'work', 'my-shard');
  writeOld(dev, { 'manifest.json': '{"id":"my-shard"}' });
  const old = path.join(root, 'LibrePad');
  writeOld(old, { 'config.json': '{}' });
  fs.mkdirSync(path.join(old, 'shards'));
  fs.symlinkSync(dev, path.join(old, 'shards', 'my-shard'), 'junction');
  const data = path.join(root, 'LibreShard');
  migrateData(root, data);
  const moved = path.join(data, 'shards', 'my-shard');
  assert.ok(fs.lstatSync(moved).isSymbolicLink());
  assert.equal(fs.realpathSync(moved), fs.realpathSync(dev));
});

test('prefers LibrePad over ShardPad, and does nothing once the new folder has a config', () => {
  const root = appData();
  writeOld(path.join(root, 'ShardPad'), { 'config.json': '{"from":"shardpad"}' });
  writeOld(path.join(root, 'LibrePad'), { 'config.json': '{"from":"librepad"}' });
  const data = path.join(root, 'LibreShard');
  migrateData(root, data);
  assert.equal(fs.readFileSync(path.join(data, 'config.json'), 'utf8'), '{"from":"librepad"}');
  fs.writeFileSync(path.join(data, 'config.json'), '{"mine":true}');
  assert.equal(migrateData(root, data), null);
  assert.equal(fs.readFileSync(path.join(data, 'config.json'), 'utf8'), '{"mine":true}');
});

test('falls back to ShardPad, and returns null when there is nothing to migrate', () => {
  const root = appData();
  assert.equal(migrateData(root, path.join(root, 'LibreShard')), null);
  writeOld(path.join(root, 'ShardPad'), { 'config.json': '{}', 'app-rules.json': '{"a":{"mode":"any"}}' });
  migrateData(root, path.join(root, 'LibreShard'));
  assert.equal(fs.readFileSync(path.join(root, 'LibreShard', 'app-rules.json'), 'utf8'), '{"a":{"mode":"any"}}');
});
