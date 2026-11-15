// The gallery (gallery.js): the index is checked like a manifest (a bad entry never hides the
// others), files must match their entry, and installed shards are matched to entries by where they
// came from or by id and author. Plus gallery links and the small-document download.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const gallery = require('../gallery');
const { parseLink } = require('../links');
const { downloadText } = require('../download');

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const entry = (extra = {}) => ({
  id: 'sc-mfd', name: 'SC MFD', author: 'Gabriel Hernandez', description: 'Cockpit MFD', icon: '🚀',
  version: '3.1.0', minAppVersion: '0.1.0', license: 'Apache-2.0', url: 'https://github.com/libreshard/libreshard-sc-mfd',
  tags: ['games'], keys: ['ralt+r', 'F5'], apps: ['starcitizen'],
  download: { url: 'https://github.com/x/sc-mfd-3.1.0.libreshard', sha256: 'a'.repeat(64), size: 100 },
  ...extra,
});

test('the index keeps valid entries, drops bad ones and refuses other formats', () => {
  const entries = gallery.cleanIndex({
    format: 1,
    shards: [
      entry(),
      entry({ id: 'zz-paid', name: 'A paid one', download: undefined, paid: true, price: '4 USD', buyUrl: 'https://shop.example/a' }),
      entry({ id: 'sc-mfd', name: 'Impostor' }), // same id: the first wins
      entry({ id: 'BAD ID' }),
      entry({ id: 'no-license', license: undefined }),
      entry({ id: 'http-download', download: { url: 'http://x.example/a', sha256: 'a'.repeat(64), size: 1 } }),
      entry({ id: 'short-sha', download: { url: 'https://x.example/a', sha256: 'abc', size: 1 } }),
      entry({ id: 'huge', download: { url: 'https://x.example/a', sha256: 'a'.repeat(64), size: 60 * 1024 * 1024 } }),
      entry({ id: 'paid-no-shop', paid: true, price: '4 USD', download: undefined }),
      entry({ id: 'no-keys', keys: [] }),
      'not an object',
      entry({ id: 'odd-fields', name: 'Odd fields', tags: ['games', 'nonsense'], url: 'javascript:alert(1)', description: 'x'.repeat(500) }),
    ],
  });
  assert.deepEqual(entries.map((e) => e.id), ['zz-paid', 'odd-fields', 'sc-mfd'], 'sorted by name');
  const sc = entries.find((e) => e.id === 'sc-mfd');
  assert.equal(sc.name, 'SC MFD');
  assert.deepEqual(sc.keys, ['ralt+r', 'f5'], 'keys normalized');
  const odd = entries.find((e) => e.id === 'odd-fields');
  assert.deepEqual(odd.tags, ['games']);
  assert.equal(odd.url, undefined);
  assert.equal([...odd.description].length, 160);
  assert.equal(entries.find((e) => e.id === 'zz-paid').download, undefined);
  assert.throws(() => gallery.cleanIndex({ format: 2, shards: [] }), /newer/);
  assert.throws(() => gallery.cleanIndex({ shards: [] }), /format/);
  assert.throws(() => gallery.cleanIndex([]), /not a gallery index/);
});

test('a downloaded file matches its entry only with the same size and sha256', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'libreshard-gal-'));
  try {
    const file = path.join(dir, 'a.libreshard');
    const data = Buffer.from('PK\u0003\u0004 a shard');
    fs.writeFileSync(file, data);
    assert.equal(gallery.matchesEntry(file, { download: { sha256: sha(data), size: data.length } }), true);
    assert.equal(gallery.matchesEntry(file, { download: { sha256: sha(data), size: data.length + 1 } }), false);
    assert.equal(gallery.matchesEntry(file, { download: { sha256: 'b'.repeat(64), size: data.length } }), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('installed shards match entries by their source, or by id and author', () => {
  const [e] = gallery.cleanIndex({ format: 1, shards: [entry()] });
  const at = (shard, appVersion = '0.5.0') => gallery.annotate([e], [shard].filter(Boolean), appVersion)[0];
  assert.equal(at(null).installed, null);
  const fromGallery = at({ id: 'sc-mfd', version: '3.0.0', author: 'Someone else', source: { kind: 'gallery', id: 'sc-mfd' } });
  assert.deepEqual([fromGallery.installed.same, fromGallery.update], [true, true], 'installed from the gallery: an older version');
  const byAuthor = at({ id: 'sc-mfd', version: '3.1.0', author: 'Gabriel Hernandez', source: { kind: 'url', host: 'github.com' } });
  assert.deepEqual([byAuthor.installed.same, byAuthor.update], [true, false], 'same id and author: the same shard, up to date');
  const other = at({ id: 'sc-mfd', version: '1.0.0', author: 'Someone else', source: null });
  assert.deepEqual([other.installed.same, other.update], [false, false], 'same id, another author: not this entry');
  const bundled = at({ id: 'sc-mfd', version: '1.0.0', author: 'Gabriel Hernandez', bundled: true });
  assert.equal(bundled.update, false);
  assert.equal(at({ id: 'sc-mfd', version: 'beta', author: 'Gabriel Hernandez' }).update, false, 'an odd version never breaks the list');
  assert.equal(at(null, '0.0.9').needsApp, true);
  assert.equal(at(null, '0.1.0').needsApp, false);
  assert.equal(gallery.entryFor([e], { id: 'sc-mfd', author: 'Gabriel Hernandez' }), e);
  assert.equal(gallery.entryFor([e], { id: 'other', author: 'Gabriel Hernandez' }), null);
});

test('gallery links name an entry; the file and its sha256 come from the index', () => {
  assert.deepEqual(parseLink('libreshard://install?gallery=sc-mfd'), { action: 'install', gallery: 'sc-mfd' });
  assert.equal(parseLink('libreshard://install?gallery=Not%20An%20Id'), null);
  assert.deepEqual(parseLink('libreshard://install?gallery=sc-mfd&url=https%3A%2F%2Fevil.example%2Fx'), { action: 'install', gallery: 'sc-mfd' }, 'the gallery wins over an address');
});

test('downloadText reads a small document with the same protections and its own size limit', async () => {
  const response = (status, body, headers = {}) => Object.assign(Readable.from([Buffer.from(body)]), { statusCode: status, headers });
  const get = async (u) => (u.hostname === 'libreshard.com' ? response(301, '', { location: 'https://cdn.example/index.json' }) : response(200, '{"format":1,"shards":[]}'));
  assert.equal(await downloadText('https://libreshard.com/gallery/index.json', { get }), '{"format":1,"shards":[]}');
  const big = async () => response(200, 'x'.repeat(50));
  await assert.rejects(downloadText('https://a.example/i.json', { get: big, limits: { maxBytes: 10, timeoutMs: 1000, maxRedirects: 5, maxUrl: 2048 } }), (e) => e.code === 'tooBig');
  await assert.rejects(downloadText('http://a.example/i.json', { get }), (e) => e.code === 'notHttps');
  await assert.rejects(downloadText('https://localhost:9/i.json'), (e) => e.code === 'privateAddress');
});
