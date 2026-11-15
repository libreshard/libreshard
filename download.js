// Downloading a shard from an https address ("Install from URL…", and later libreshard:// links
// and the gallery). The file goes to a temporary folder and then through installer.prepare(), like
// any .libreshard the user picked; nothing here installs anything.
//
// Only public https servers: a web page must not be able to use LibreShard to reach devices on the
// user's own network (a router, a NAS, a printer). Every address a name resolves to is checked at
// the moment of connecting (the `lookup` given to https.get), so a name can't pass the check and
// then point somewhere else. Redirects are followed by hand, each one checked the same way.
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const dns = require('dns');
const { isIP } = require('net');
const { isPublicAddress } = require('./net');

const LIMITS = { maxBytes: 50 * 1024 * 1024, timeoutMs: 60000, maxRedirects: 5, maxUrl: 2048 };

class DownloadError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.code = code;
    Object.assign(this, details);
  }
}

// An https:// address with a host, no user name or password, not too long. A URL object, or a
// DownloadError to throw.
function checkUrl(value, base) {
  let u;
  try { u = base ? new URL(value, base) : new URL(String(value).trim()); } catch { return new DownloadError('badUrl'); }
  if (u.href.length > LIMITS.maxUrl) return new DownloadError('badUrl');
  if (u.protocol !== 'https:') return new DownloadError('notHttps');
  if (!u.hostname || u.username || u.password) return new DownloadError('badUrl');
  const literal = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(literal) && !isPublicAddress(literal)) return new DownloadError('privateAddress', { host: u.hostname });
  return u;
}

// dns.lookup that refuses names resolving to any non-public address (all of them are checked,
// since the connection may use any)
function safeLookup(lookup = dns.lookup) {
  return (hostname, options, cb) => {
    if (typeof options === 'function') { cb = options; options = {}; }
    lookup(hostname, { ...options, all: true }, (err, addrs) => {
      if (err) return cb(err);
      const list = Array.isArray(addrs) ? addrs : [{ address: addrs, family: isIP(addrs) }];
      if (!list.length || list.some((a) => !isPublicAddress(a.address))) {
        const e = new Error(`${hostname} is not a public address`);
        e.code = 'EPRIVATE';
        return cb(e);
      }
      if (options.all) cb(null, list);
      else cb(null, list[0].address, list[0].family);
    });
  };
}

// The real request: resolves with the response (an IncomingMessage), rejects on network errors
function httpsGet(url, { lookup, headers, signal }) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { lookup, headers, signal }, resolve);
    req.on('error', reject);
  });
}

// Requests `u` (a checked URL), following redirects by hand: { res, u } with the final 200 response
async function respond(u, { get, lookup, limits, signal, onHop }) {
  for (let hops = 0; ; hops++) {
    const res = await get(u, { lookup: safeLookup(lookup), headers: { 'User-Agent': 'LibreShard', Accept: '*/*' }, signal });
    const status = res.statusCode;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      if (hops >= limits.maxRedirects) throw new DownloadError('tooManyRedirects');
      const next = checkUrl(res.headers.location, u);
      if (next instanceof DownloadError) throw next;
      u = next;
      onHop?.(u);
      continue;
    }
    if (status !== 200) { res.resume(); throw new DownloadError('httpStatus', { status }); }
    return { res, u };
  }
}

// A small text document (the gallery's index), kept in memory: the same checks as downloadShard,
// with its own limits (2 MB, 20 s by default). Resolves with the text.
async function downloadText(url, { get = httpsGet, lookup, limits = { ...LIMITS, maxBytes: 2 * 1024 * 1024, timeoutMs: 20000 } } = {}) {
  let u = checkUrl(url);
  if (u instanceof DownloadError) throw u;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, limits.timeoutMs);
  try {
    const { res } = await respond(u, { get, lookup, limits, signal: controller.signal, onHop: (next) => { u = next; } });
    if (Number(res.headers['content-length']) > limits.maxBytes) { res.destroy(); throw new DownloadError('tooBig'); }
    const chunks = [];
    let bytes = 0;
    for await (const chunk of res) {
      bytes += chunk.length;
      if (bytes > limits.maxBytes) { res.destroy(); throw new DownloadError('tooBig'); }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  } catch (e) {
    if (e instanceof DownloadError) throw e;
    if (timedOut) throw new DownloadError('timeout');
    if (e && e.code === 'EPRIVATE') throw new DownloadError('privateAddress', { host: u.hostname });
    throw new DownloadError('network', { reason: e && (e.code || e.message) });
  } finally {
    clearTimeout(timer);
  }
}

// Downloads `url` into a new temporary folder. Returns { file, bytes, host, finalHost, cleanup }
// (host: the one in the address the user gave; finalHost: the server the file came from after
// redirects, often a CDN), or throws a DownloadError with a code: badUrl, notHttps,
// privateAddress, tooManyRedirects, httpStatus (status), tooBig, timeout, network.
// `get` and `lookup` are injectable for tests.
async function downloadShard(url, { get = httpsGet, lookup, limits = LIMITS, tmp = os.tmpdir() } = {}) {
  let u = checkUrl(url);
  if (u instanceof DownloadError) throw u;
  const host = u.hostname;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, limits.timeoutMs);
  const dir = fs.mkdtempSync(path.join(tmp, 'libreshard-download-'));
  // Retries: on Windows a file stream that was just destroyed may still be closing
  const cleanup = () => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  const fail = (e) => {
    if (e instanceof DownloadError) return e;
    if (timedOut) return new DownloadError('timeout');
    if (e && e.code === 'EPRIVATE') return new DownloadError('privateAddress', { host: u.hostname });
    return new DownloadError('network', { reason: e && (e.code || e.message) });
  };
  try {
    let res;
    ({ res, u } = await respond(u, { get, lookup, limits, signal: controller.signal, onHop: (next) => { u = next; } }));
    const declared = Number(res.headers['content-length']);
    if (declared > limits.maxBytes) { res.destroy(); throw new DownloadError('tooBig'); }
    // installer.prepare() only opens .zip/.libreshard files
    const file = path.join(dir, 'download.libreshard');
    let bytes = 0;
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(file);
      const stop = (e) => { res.destroy(); out.destroy(); reject(e); };
      res.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes > limits.maxBytes) stop(new DownloadError('tooBig'));
      });
      res.on('error', stop);
      out.on('error', stop);
      out.on('finish', resolve);
      res.pipe(out);
    });
    return { file, bytes, host, finalHost: u.hostname, cleanup };
  } catch (e) {
    cleanup();
    throw fail(e);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { downloadShard, downloadText, checkUrl, safeLookup, DownloadError, LIMITS };
