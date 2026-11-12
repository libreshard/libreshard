const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { prepare, extractZip } = require('../installer');
const { makeZip } = require('./zip');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'libreshard-inst-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const manifest = (extra = {}) => JSON.stringify({ id: 'demo', name: 'Demo', version: '1.0.0', permissions: { keys: ['f13', 'ctrl+s'] }, ...extra });
let n = 0;
const writeZip = (entries) => {
  const file = path.join(tmp, `z${++n}.zip`);
  fs.writeFileSync(file, makeZip(entries));
  return file;
};

test('a zip with the shard at its root is prepared for review', async () => {
  const r = await prepare(writeZip([
    { name: 'manifest.json', data: manifest() },
    { name: 'index.html', data: '<button data-key="f13">x</button>' },
    { name: 'img/', data: '' },
    { name: 'img/a.png', data: 'png' },
  ]));
  try {
    assert.ok(r.ok, (r.errors || []).join());
    assert.equal(r.manifest.id, 'demo');
    assert.deepEqual(r.size, { files: 3, bytes: Buffer.byteLength(manifest()) + 33 + 3 });
    assert.deepEqual(r.risk.dangerous, []);
    assert.equal(r.update, null);
  } finally { r.cleanup(); }
});

test('a zip with the shard inside one folder works too, and .libreshard is a zip', async () => {
  const file = writeZip([
    { name: 'my-shard/manifest.json', data: manifest() },
    { name: 'my-shard/index.html', data: 'x' },
    { name: '__MACOSX/junk', data: 'x' },
  ]);
  const libreshard = file.replace(/\.zip$/, '.libreshard');
  fs.renameSync(file, libreshard);
  const r = await prepare(libreshard);
  try {
    assert.ok(r.ok, (r.errors || []).join());
    assert.equal(path.basename(r.root), 'my-shard');
  } finally { r.cleanup(); }
});

test('entries that escape the folder are refused', async () => {
  for (const name of ['../evil.txt', 'a/../../evil.txt', '/abs.txt', 'C:/evil.txt']) {
    await assert.rejects(prepare(writeZip([{ name: 'manifest.json', data: manifest() }, { name, data: 'x' }])), /path|invalid|absolute/i, name);
  }
  assert.ok(!fs.existsSync(path.join(os.tmpdir(), 'evil.txt')));
});

test('symlinks inside a zip are skipped', async () => {
  const dir = await extractZip(writeZip([
    { name: 'manifest.json', data: manifest() },
    { name: 'link', data: '/etc/passwd', symlink: true },
  ]));
  try {
    assert.ok(fs.existsSync(path.join(dir, 'manifest.json')));
    assert.ok(!fs.existsSync(path.join(dir, 'link')));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the size and file count limits are enforced while extracting, and leave nothing behind', async () => {
  const temps = () => fs.readdirSync(os.tmpdir()).filter((d) => d.startsWith('libreshard-install-')).sort();
  const before = temps();
  const big = writeZip([{ name: 'manifest.json', data: manifest() }, { name: 'big.bin', data: 'x'.repeat(5000) }]);
  await assert.rejects(extractZip(big, { maxBytes: 1000, maxFiles: 100 }), /larger than/);
  const many = writeZip(Array.from({ length: 12 }, (_, i) => ({ name: `f${i}.txt`, data: 'x' })));
  await assert.rejects(extractZip(many, { maxBytes: 1e6, maxFiles: 10 }), /more than 10 files/);
  assert.deepEqual(temps(), before, 'failed extractions remove their temporary folder');
});

test('invalid shards explain why', async () => {
  const cases = [
    [[{ name: 'readme.txt', data: 'x' }], /No manifest\.json/],
    [[{ name: 'manifest.json', data: '{ nope' }, { name: 'index.html', data: 'x' }], /not valid JSON/],
    [[{ name: 'manifest.json', data: manifest({ id: 'Bad Id' }) }, { name: 'index.html', data: 'x' }], /"id"/],
    [[{ name: 'manifest.json', data: manifest() }], /no index\.html/],
  ];
  for (const [entries, error] of cases) {
    const r = await prepare(writeZip(entries));
    assert.ok(!r.ok);
    assert.match(r.errors.join(), error);
  }
  assert.match((await prepare(path.join(tmp, 'z1.zip').replace('.zip', '.txt')).catch((e) => ({ errors: [e.message] }))).errors.join(), /ENOENT|Pick/);
  const notZip = path.join(tmp, 'fake.zip');
  fs.writeFileSync(notZip, 'not a zip');
  await assert.rejects(prepare(notZip), /Not a valid zip/);
});

test('a folder can be prepared directly', async () => {
  const dir = path.join(tmp, 'folder-shard');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'manifest.json'), manifest({ permissions: { keys: ['win+r', ...'abcdefghij'.split(''), 'enter'] } }));
  fs.writeFileSync(path.join(dir, 'index.html'), 'x');
  const r = await prepare(dir);
  assert.ok(r.ok);
  assert.equal(r.root, dir);
  assert.ok(r.risk.warning, 'win+r plus typing plus enter is flagged');
});

test('updates show the version and the key changes; bundled and linked ids are refused', async () => {
  const file = writeZip([{ name: 'manifest.json', data: manifest({ version: '2.0.0', permissions: { keys: ['f13', 'f14'] } }) }, { name: 'index.html', data: 'x' }]);
  const existing = { bundled: false, linked: false, manifest: { version: '1.0.0', keys: ['f13', 'ctrl+s'] } };
  const r = await prepare(file, { existing });
  try {
    assert.deepEqual(r.update, { fromVersion: '1.0.0', addedKeys: ['f14'], removedKeys: ['ctrl+s'] });
  } finally { r.cleanup(); }
  assert.match((await prepare(file, { existing: { ...existing, bundled: true } })).errors.join(), /bundled/);
  assert.match((await prepare(file, { existing: { ...existing, linked: true } })).errors.join(), /linked/);
});
