// Writing zips (zip.js): what the installer reads back is what was written, and an exported shard
// installs with the same manifest and files, without hidden files or links.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createZip, filesUnder, shardZip } = require('../zip');
const installer = require('../installer');
const { validatePanel, buildShard, importedImages } = require('../panel-format');
const { PANEL_TEMPLATE } = require('../tools/build-shard-base');

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `libreshard-zip-${name}-`));
const rm = (...dirs) => dirs.forEach((d) => fs.rmSync(d, { recursive: true, force: true }));

test('the installer reads back every entry of a zip, UTF-8 names and folders included', async () => {
  const dir = tmp('out');
  const file = path.join(dir, 'x.zip');
  let extracted;
  try {
    const entries = [
      { name: 'manifest.json', data: Buffer.from('{}') },
      { name: 'images/añil.png', data: Buffer.from([0, 1, 2, 255]) },
      { name: 'deep/a/b/c.txt', data: Buffer.from('x'.repeat(10000)) },
    ];
    fs.writeFileSync(file, createZip(entries));
    extracted = await installer.extractZip(file);
    for (const e of entries) assert.deepEqual(fs.readFileSync(path.join(extracted, e.name)), e.data, e.name);
  } finally { rm(dir, ...(extracted ? [extracted] : [])); }
});

test('an exported shard installs with the same manifest and files, without hidden files or links', async () => {
  const src = tmp('shard');
  const outside = tmp('outside');
  const out = tmp('export');
  let prepared;
  try {
    const manifest = { id: 'mine', name: 'Mine', version: '1.2.0', permissions: { keys: ['f13', 'ctrl+c'] } };
    fs.writeFileSync(path.join(src, 'manifest.json'), JSON.stringify(manifest));
    fs.writeFileSync(path.join(src, 'index.html'), '<button data-key="f13">x</button>');
    fs.mkdirSync(path.join(src, 'images'));
    fs.writeFileSync(path.join(src, 'images', 'a.png'), Buffer.from([1, 2, 3]));
    fs.writeFileSync(path.join(src, '.DS_Store'), 'junk');
    fs.mkdirSync(path.join(src, '.git'));
    fs.writeFileSync(path.join(src, '.git', 'config'), 'secret');
    fs.writeFileSync(path.join(outside, 'private.txt'), 'not mine to share');
    fs.symlinkSync(outside, path.join(src, 'link'), 'junction');

    assert.deepEqual(filesUnder(src, { hidden: false }).sort(), ['images/a.png', 'index.html', 'manifest.json']);
    assert.ok(filesUnder(src).includes('.git/config'), 'backups keep hidden files');

    const file = path.join(out, 'mine-1.2.0.libreshard');
    fs.writeFileSync(file, shardZip(src));
    prepared = await installer.prepare(file);
    assert.equal(prepared.ok, true, JSON.stringify(prepared.errors));
    assert.equal(prepared.manifest.id, 'mine');
    assert.equal(prepared.manifest.version, '1.2.0');
    assert.deepEqual(prepared.manifest.keys, ['f13', 'ctrl+c']);
    assert.deepEqual(filesUnder(prepared.root).sort(), ['images/a.png', 'index.html', 'manifest.json']);
    assert.deepEqual(fs.readFileSync(path.join(prepared.root, 'images', 'a.png')), Buffer.from([1, 2, 3]));
  } finally {
    prepared?.cleanup?.();
    rm(src, outside, out);
  }
});

test('an exported panel installs again, and a panel with Stream Deck images is recognized', async () => {
  const src = tmp('panel');
  const out = tmp('export');
  let prepared;
  try {
    const template = {};
    for (const name of fs.readdirSync(PANEL_TEMPLATE)) template[name] = fs.readFileSync(path.join(PANEL_TEMPLATE, name), 'utf8');
    const raw = {
      format: 1, grid: { cols: 2, rows: 1 },
      pages: [{ id: 'p1', buttons: [
        { id: 'a', col: 0, row: 0, type: 'press', key: 'f13', icon: { kind: 'image', file: 'images/aaaaaaaaaaaa.png', imported: 'streamdeck' } },
        { id: 'b', col: 1, row: 0, type: 'press', key: 'f14', icon: { kind: 'image', file: 'images/bbbbbbbbbbbb.png' } },
      ] }],
    };
    const { panel } = validatePanel(raw);
    assert.deepEqual(importedImages(panel), ['images/aaaaaaaaaaaa.png']);
    const { files } = buildShard({ panel, meta: { name: 'Shared' }, template });
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(src, name), content);
    fs.mkdirSync(path.join(src, 'images'));
    for (const f of ['aaaaaaaaaaaa', 'bbbbbbbbbbbb']) fs.writeFileSync(path.join(src, 'images', f + '.png'), Buffer.from(f));

    const file = path.join(out, 'panel.libreshard');
    fs.writeFileSync(file, shardZip(src));
    prepared = await installer.prepare(file, { appVersion: '0.4.0' });
    assert.equal(prepared.ok, true, JSON.stringify(prepared.errors));
    assert.deepEqual(prepared.manifest.keys, ['f13', 'f14']);
    assert.deepEqual(filesUnder(prepared.root).sort(), filesUnder(src).sort());
    const back = JSON.parse(fs.readFileSync(path.join(prepared.root, 'panel.json'), 'utf8'));
    assert.deepEqual(validatePanel(back, { files: new Set(['images/aaaaaaaaaaaa.png', 'images/bbbbbbbbbbbb.png']) }).panel, panel);
  } finally {
    prepared?.cleanup?.();
    rm(src, out);
  }
});
