// Downloading shards (download.js): https only, public servers only (checked at connect time and on
// every redirect), size and time limits, and nothing left behind in the temporary folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const { downloadShard, checkUrl, safeLookup, DownloadError } = require('../download');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'libreshard-dltest-'));
const leftovers = (dir) => fs.readdirSync(dir).filter((n) => n.startsWith('libreshard-download-'));

// A fake response: a readable stream with a status and headers
function response(status, { headers = {}, chunks = [] } = {}) {
  const r = Readable.from(chunks.map((c) => Buffer.from(c)));
  r.statusCode = status;
  r.headers = headers;
  return r;
}
// A fake get() answering from a table of URL → response (or function)
const server = (routes, seen = []) => async (u, opts) => {
  seen.push(u.href);
  assert.equal(typeof opts.lookup, 'function', 'every request checks the addresses it connects to');
  const route = routes[u.href];
  if (!route) return response(404);
  return typeof route === 'function' ? route(u, opts) : route();
};
const code = async (p) => { try { await p; return 'ok'; } catch (e) { assert.ok(e instanceof DownloadError, String(e)); return e.code; } };

test('only https addresses with a host, no credentials and no private literal addresses', () => {
  assert.equal(checkUrl('https://example.com/a.libreshard').hostname, 'example.com');
  for (const [url, expected] of [
    ['http://example.com/a', 'notHttps'], ['ftp://example.com/a', 'notHttps'], ['javascript:alert(1)', 'notHttps'],
    ['not a url', 'badUrl'], ['https://user:pw@example.com/', 'badUrl'], ['https://example.com/' + 'a'.repeat(3000), 'badUrl'],
    ['https://127.0.0.1/a', 'privateAddress'], ['https://192.168.1.20/a', 'privateAddress'], ['https://[::1]/a', 'privateAddress'],
    ['https://[::ffff:10.0.0.1]/a', 'privateAddress'], ['https://169.254.169.254/latest', 'privateAddress'],
  ]) assert.equal(checkUrl(url).code, expected, url);
  assert.equal(checkUrl('https://8.8.8.8/a').hostname, '8.8.8.8');
});

test('names are refused when any address they resolve to is not public', async () => {
  const fakeDns = (table) => (host, opts, cb) => cb(null, table[host].map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
  const lookup = safeLookup(fakeDns({ good: ['93.184.216.34', '2606:2800:220:1::'], bad: ['93.184.216.34', '10.0.0.7'], local: ['127.0.0.1'] }));
  const ask = (host, opts) => new Promise((resolve) => lookup(host, opts, (err, a, f) => resolve(err ? err.code : [a, f])));
  assert.deepEqual(await ask('good', {}), ['93.184.216.34', 4]);
  assert.equal((await ask('good', { all: true })).length, 2);
  assert.equal(await ask('bad', {}), 'EPRIVATE');
  assert.equal(await ask('local', { all: true }), 'EPRIVATE');
});

test('a real request to a name that resolves to this machine is refused before connecting', async () => {
  const dir = tmp();
  try {
    assert.equal(await code(downloadShard('https://localhost:9/x.libreshard', { tmp: dir })), 'privateAddress');
    assert.deepEqual(leftovers(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a download follows https redirects to public servers and keeps the file', async () => {
  const dir = tmp();
  const seen = [];
  try {
    const get = server({
      'https://shop.example/buy/1': () => response(302, { headers: { location: 'https://cdn.example/files/a.libreshard?token=secret' } }),
      'https://cdn.example/files/a.libreshard?token=secret': () => response(200, { headers: { 'content-length': '6' }, chunks: ['PK', '\u0003\u0004', 'zz'] }),
    }, seen);
    const d = await downloadShard('https://shop.example/buy/1', { get, tmp: dir });
    assert.equal(d.host, 'shop.example', 'the server the user asked, without the path');
    assert.equal(d.finalHost, 'cdn.example', 'and the one the file came from, without its token');
    assert.equal(d.bytes, 6);
    assert.ok(d.file.endsWith('.libreshard'), 'installer.prepare opens .libreshard files');
    assert.equal(fs.readFileSync(d.file, 'latin1'), 'PK\u0003\u0004zz');
    assert.equal(seen.length, 2);
    d.cleanup();
    assert.deepEqual(leftovers(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('redirects to http, to private addresses or in a loop are refused', async () => {
  const dir = tmp();
  try {
    const redirect = (to) => () => response(301, { headers: { location: to } });
    assert.equal(await code(downloadShard('https://a.example/', { get: server({ 'https://a.example/': redirect('http://a.example/f') }), tmp: dir })), 'notHttps');
    assert.equal(await code(downloadShard('https://a.example/', { get: server({ 'https://a.example/': redirect('https://10.0.0.5/f') }), tmp: dir })), 'privateAddress');
    assert.equal(await code(downloadShard('https://a.example/', { get: server({ 'https://a.example/': redirect('/') }), tmp: dir })), 'tooManyRedirects');
    assert.deepEqual(leftovers(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('errors, oversized files and slow servers stop the download and leave nothing behind', async () => {
  const dir = tmp();
  const limits = { maxBytes: 10, timeoutMs: 200, maxRedirects: 5, maxUrl: 2048 };
  try {
    const status = await downloadShard('https://a.example/missing', { get: server({}), tmp: dir, limits }).catch((e) => e);
    assert.equal(status.code, 'httpStatus');
    assert.equal(status.status, 404);
    assert.equal(await code(downloadShard('https://a.example/f', { get: server({ 'https://a.example/f': () => response(200, { headers: { 'content-length': '999' } }) }), tmp: dir, limits })), 'tooBig');
    // No size announced: counted while it arrives
    assert.equal(await code(downloadShard('https://a.example/f', { get: server({ 'https://a.example/f': () => response(200, { chunks: ['123456', '789012'] }) }), tmp: dir, limits })), 'tooBig');
    // A server that never answers: the request is aborted
    const hang = async (_u, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
    assert.equal(await code(downloadShard('https://a.example/f', { get: hang, tmp: dir, limits })), 'timeout');
    // A lookup that refused a private address surfaces as such
    const refused = async () => { const e = new Error('x'); e.code = 'EPRIVATE'; throw e; };
    assert.equal(await code(downloadShard('https://a.example/f', { get: refused, tmp: dir, limits })), 'privateAddress');
    const broken = async () => { const e = new Error('reset'); e.code = 'ECONNRESET'; throw e; };
    const net = await downloadShard('https://a.example/f', { get: broken, tmp: dir, limits }).catch((e) => e);
    assert.equal(net.code, 'network');
    assert.equal(net.reason, 'ECONNRESET');
    assert.deepEqual(leftovers(dir), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
