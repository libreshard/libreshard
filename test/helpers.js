// Shared helpers for the server tests: temporary shards, a fake keyboard and a WebSocket client.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const WebSocket = require('ws');
const { startServer } = require('../server');
const { Devices, Pairing } = require('../pairing');

// Writes { folder: { manifest, files } } as shard folders inside a new temporary directory
function makeShardDir(shards) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'libreshard-test-'));
  for (const [folder, { manifest, files = {} }] of Object.entries(shards)) {
    const root = path.join(dir, folder);
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'manifest.json'), typeof manifest === 'string' ? manifest : JSON.stringify(manifest));
    fs.writeFileSync(path.join(root, 'index.html'), files['index.html'] || '<button data-key="f13">x</button>');
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(root, name), content);
  }
  return dir;
}

// Records every pressKey/releaseKey call as { t: 'press' | 'release', k }
function fakeKeyboard() {
  const events = [];
  return {
    events,
    pressKey: async (k) => { events.push({ t: 'press', k }); },
    releaseKey: async (k) => { events.push({ t: 'release', k }); },
  };
}

// focus.check() always answers with whatever `result` currently holds, and focus.active() with `app`
function fakeFocus(result = { ok: true }, app = null) {
  const f = {
    result, app, calls: [], activeCalls: 0,
    check: async (apps) => { f.calls.push(apps); return f.result; },
    active: async () => { f.activeCalls++; return f.app; },
  };
  return f;
}

// Starts a server on a random port with fakes, plus one paired device whose token is returned
async function start(opts) {
  const keyboard = opts.keyboard || fakeKeyboard();
  const focus = opts.focus || fakeFocus();
  const devices = opts.devices || new Devices(null);
  const pairing = opts.pairing || new Pairing();
  const { token, device } = devices.add('Test tablet', '127.0.0.1');
  // The keyboard is fake, so the machine's real keymap (F13+ missing on Linux) doesn't apply
  const unavailableKeys = opts.unavailableKeys || (() => []);
  const server = await startServer({ port: 0, host: '127.0.0.1', ...opts, keyboard, focus, devices, pairing, unavailableKeys });
  const { port } = server.address();
  return { server, port, keyboard, focus, devices, pairing, token, device, base: `http://127.0.0.1:${port}` };
}

// Every client ever opened, so a failing test can't leave one that keeps server.close() waiting
const clients = new Set();
function closeClients() {
  for (const ws of clients) ws.terminate();
  clients.clear();
}

// WebSocket client with a queue of received messages and a promise for the close event.
// `origin` defaults to the server's own; pass null to send none.
function connect(port, { origin = `http://127.0.0.1:${port}` } = {}) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, origin === null ? {} : { origin });
  clients.add(ws);
  const inbox = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw);
    const w = waiters.shift();
    if (w) w(msg); else inbox.push(msg);
  });
  const closed = new Promise((resolve) => ws.on('close', (code) => resolve(code)));
  const opened = new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
    ws.on('unexpected-response', (_req, res) => reject(Object.assign(new Error('rejected'), { status: res.statusCode })));
  });
  opened.catch(() => {}); // tests that expect a rejection await it themselves
  return {
    ws,
    closed,
    opened,
    send: (obj) => ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)),
    next: (ms = 1000) => new Promise((resolve, reject) => {
      if (inbox.length) return resolve(inbox.shift());
      const timer = setTimeout(() => reject(new Error('no message within ' + ms + ' ms')), ms);
      waiters.push((m) => { clearTimeout(timer); resolve(m); });
    }),
    inbox,
  };
}

// Connects and authenticates with the server's paired test device
async function authed({ port, token }) {
  const c = connect(port);
  await c.opened;
  c.send({ type: 'auth', token });
  const ok = await c.next();
  if (ok.type !== 'ok') throw new Error('auth failed: ' + JSON.stringify(ok));
  return c;
}

// Polls until fn() is truthy
async function waitFor(fn, ms = 1000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
}

// Raw HTTP GET that keeps the path exactly as given (fetch would normalize "../")
function rawGet(port, rawPath, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: rawPath, headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on('error', reject);
  });
}

module.exports = { makeShardDir, fakeKeyboard, fakeFocus, start, connect, closeClients, authed, waitFor, rawGet };
