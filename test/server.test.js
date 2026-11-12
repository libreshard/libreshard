const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Key } = require('@nut-tree-fork/nut-js');
const { startServer } = require('../server');
const { ShardStore, loadRules, resolveApps } = require('../shard-store');
const { RateLimiter, Devices } = require('../pairing');
const { makeShardDir, fakeFocus, start, connect, closeClients, authed, waitFor, rawGet } = require('./helpers');

const shardDir = makeShardDir({
  demo: {
    manifest: { id: 'demo', name: 'Demo', permissions: { keys: ['ctrl+shift+m', 'f13', 'shift', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k'] } },
    files: { 'style.css': 'button{}', '.secret': 'hidden' },
  },
  restricted: {
    manifest: { id: 'restricted', name: 'Restricted', apps: ['photoshop'], permissions: { keys: ['b'] } },
  },
  'bad-id': { manifest: { id: 'Bad Id!', name: 'Ignored', permissions: { keys: ['a'] } } },
  'bad-key': { manifest: { id: 'bad-key', permissions: { keys: ['ctrl+banana'] } } },
  'bad-json': { manifest: '{ nope' },
});

// A folder outside every shard directory, reachable only through links
const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'libreshard-outside-'));
fs.writeFileSync(path.join(outside, 'secret.txt'), 'top secret');
fs.mkdirSync(path.join(outside, 'linked'));
fs.writeFileSync(path.join(outside, 'linked', 'manifest.json'), JSON.stringify({ id: 'linked', permissions: { keys: ['f13'] } }));
fs.writeFileSync(path.join(outside, 'linked', 'index.html'), 'linked shard');
// demo/escape → outside (a link inside a shard must not expose files outside it)
fs.symlinkSync(outside, path.join(shardDir, 'demo', 'escape'), 'junction');
// shardDir/linked → outside/linked (a whole shard that is a development link must keep working)
fs.symlinkSync(path.join(outside, 'linked'), path.join(shardDir, 'linked'), 'junction');

test.after(() => {
  fs.rmSync(shardDir, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

// One server per test, closed afterwards
async function withServer(opts, fn) {
  const s = await start({ shardDirs: [shardDir], ...opts });
  try {
    await fn(s);
  } finally {
    closeClients();
    s.pairing.stop();
    await new Promise((r) => s.server.close(r));
  }
}

const press = (k) => ({ t: 'press', k });
const release = (k) => ({ t: 'release', k });

/* ---------- Authentication and pairing ---------- */

test('a paired device authenticates with its token', () => withServer({}, async (s) => {
  const c = connect(s.port);
  await c.opened;
  c.send({ type: 'auth', token: s.token });
  assert.deepEqual(await c.next(), { type: 'ok', device: { id: s.device.id, name: 'Test tablet' }, paused: false });
}));

test('an unknown token closes the socket with 4001', () => withServer({}, async ({ port }) => {
  const c = connect(port);
  await c.opened;
  c.send({ type: 'auth', token: 'not-a-real-token' });
  assert.equal(await c.closed, 4001);
}));

test('an auth message without a token closes the socket with 4001', () => withServer({}, async ({ port }) => {
  const c = connect(port);
  await c.opened;
  c.send({ type: 'auth' });
  assert.equal(await c.closed, 4001);
}));

test('any key message before auth closes the socket with 4001', () => withServer({}, async ({ port, keyboard }) => {
  const c = connect(port);
  await c.opened;
  c.send({ type: 'press', shard: 'demo', keys: 'f13' });
  assert.equal(await c.closed, 4001);
  assert.equal(keyboard.events.length, 0);
}));

test('pairing with the code creates a device whose token works, and uses the code up', () => withServer({}, async (s) => {
  const { code } = s.pairing.current();
  const c = connect(s.port);
  await c.opened;
  c.send({ type: 'pair', code, name: 'iPad · Safari' });
  const paired = await c.next();
  assert.equal(paired.type, 'paired');
  assert.equal(paired.device.name, 'iPad · Safari');
  assert.equal(typeof paired.token, 'string');
  assert.equal(s.devices.all().length, 2);
  assert.ok(!JSON.stringify(s.devices.list).includes(paired.token), 'only the hash is stored');

  // The new token logs in on a fresh connection
  await authed({ port: s.port, token: paired.token });

  // The same code doesn't work twice
  const again = connect(s.port);
  await again.opened;
  again.send({ type: 'pair', code });
  assert.deepEqual(await again.next(), { type: 'error', code: 'pair-failed' });
  assert.equal(await again.closed, 4001);
}));

test('pairing with the QR token works too', () => withServer({}, async (s) => {
  const c = connect(s.port);
  await c.opened;
  c.send({ type: 'pair', token: s.pairing.current().token, name: 'Android · Chrome' });
  assert.equal((await c.next()).type, 'paired');
}));

test('repeated wrong codes are rate limited (4029 with retryAfter)', () => withServer({}, async (s) => {
  const wrong = s.pairing.current().code === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) {
    const c = connect(s.port);
    await c.opened;
    c.send({ type: 'pair', code: wrong });
    assert.equal(await c.closed, 4001);
  }
  // Even the right code is refused while blocked
  const c = connect(s.port);
  await c.opened;
  c.send({ type: 'pair', code: s.pairing.current().code });
  const err = await c.next();
  assert.equal(err.code, 'rate-limited');
  assert.ok(err.retryAfter > 0 && err.retryAfter <= 30);
  assert.equal(await c.closed, 4029);
}));

test('crossing the global failure threshold raises an alert', () => {
  const alerts = [];
  const limiter = new RateLimiter({ maxFailures: 100, globalMax: 3 });
  return withServer({ limiter, onAlert: (a) => alerts.push(a) }, async (s) => {
    for (let i = 0; i < 4; i++) {
      const c = connect(s.port);
      await c.opened;
      c.send({ type: 'pair', code: 'nope' });
      await c.closed;
    }
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].ip, '127.0.0.1');
  });
});

test('removing a device disconnects it at once', () => withServer({}, async (s) => {
  const c = await authed(s);
  s.devices.remove(s.device.id);
  assert.equal(await c.closed, 4001);
}));

/* ---------- Origin, host and headers ---------- */

test('WebSocket connections from another origin are refused', () => withServer({}, async ({ port }) => {
  await assert.rejects(connect(port, { origin: 'http://evil.example' }).opened, { status: 403 });
  await assert.rejects(connect(port, { origin: null }).opened, { status: 403 });
}));

test('requests for a foreign Host are refused (DNS rebinding)', () => withServer({}, async ({ port }) => {
  assert.equal((await rawGet(port, '/', { Host: 'evil.example' })).status, 403);
  assert.equal((await rawGet(port, '/api/shards', { Host: 'evil.example:' + port })).status, 403);
  assert.equal((await rawGet(port, '/', { Host: 'localhost:' + port })).status, 200);
}));

test('the viewer gets a CSP that only allows itself', () => withServer({}, async ({ port }) => {
  const r = await rawGet(port, '/');
  const csp = r.headers['content-security-policy'];
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, new RegExp(`connect-src 'self' ws://127\\.0\\.0\\.1:${port}`));
  assert.match(csp, /frame-ancestors 'none'/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.equal(r.headers['referrer-policy'], 'no-referrer');
  assert.equal(r.headers['x-powered-by'], undefined);
}));

test('too many HTTP requests from one address get 429, and the WebSocket still works', () => withServer({ httpRate: 3 }, async (s) => {
  for (let i = 0; i < 3; i++) assert.equal((await rawGet(s.port, '/shards/demo/style.css')).status, 200);
  const r = await rawGet(s.port, '/shards/demo/index.html');
  assert.equal(r.status, 429);
  assert.ok(r.headers['retry-after']);
  assert.equal((await rawGet(s.port, '/api/shards')).status, 429);
  // A foreign Host is refused before it counts or is limited
  assert.equal((await rawGet(s.port, '/', { Host: 'evil.example' })).status, 403);
  await authed(s);
}));

/* ---------- Keys ---------- */

test('press sends modifiers first and releases them last', () => withServer({}, async (s) => {
  const c = await authed(s);
  c.send({ type: 'press', shard: 'demo', keys: ' Ctrl + Shift + M ' });
  await waitFor(() => s.keyboard.events.length === 6);
  assert.deepEqual(s.keyboard.events, [
    press(Key.LeftControl), press(Key.LeftShift), press(Key.M),
    release(Key.M), release(Key.LeftShift), release(Key.LeftControl),
  ]);
}));

test('undeclared keys are denied and never typed', () => withServer({}, async (s) => {
  const c = await authed(s);
  c.send({ type: 'press', shard: 'demo', keys: 'win+r' });
  assert.deepEqual(await c.next(), { type: 'denied', shard: 'demo', keys: 'win+r' });
  assert.equal(s.keyboard.events.length, 0);
}));

test('unknown shards, message types and malformed fields are ignored', () => withServer({}, async (s) => {
  const c = await authed(s);
  c.send({ type: 'press', shard: 'nope', keys: 'f13' });
  c.send({ type: 'exec', shard: 'demo', keys: 'f13' });
  c.send({ type: 'press', shard: 'Bad Id!', keys: 'a' });
  c.send({ type: 'press', shard: 'demo', keys: 'f'.repeat(65) });
  c.send({ type: 'press', shard: ['demo'], keys: 'f13' });
  c.send('not json');
  // The first reply must be the denial of this message, so the ones above produced nothing
  c.send({ type: 'press', shard: 'demo', keys: 'x' });
  assert.equal((await c.next()).type, 'denied');
  assert.equal(s.keyboard.events.length, 0);
}));

test('a shard limited to apps is blocked when another app is active', () => {
  const focus = fakeFocus({ ok: false, reason: 'wrong-app', active: 'Spotify (Spotify.exe)' });
  return withServer({ focus }, async (s) => {
    const c = await authed(s);
    c.send({ type: 'press', shard: 'restricted', keys: 'b' });
    assert.deepEqual(await c.next(), {
      type: 'blocked', shard: 'restricted', keys: 'b',
      apps: ['photoshop'], active: 'Spotify (Spotify.exe)', reason: 'wrong-app',
    });
    assert.deepEqual(focus.calls, [[{ match: 'photoshop' }]]);
    assert.equal(s.keyboard.events.length, 0);

    focus.result = { ok: true };
    c.send({ type: 'press', shard: 'restricted', keys: 'b' });
    await waitFor(() => s.keyboard.events.length === 2);
  });
});

test('shards without apps never ask for the foreground app', () => {
  const focus = fakeFocus({ ok: false, reason: 'unknown', active: '' });
  return withServer({ focus }, async (s) => {
    const c = await authed(s);
    c.send({ type: 'press', shard: 'demo', keys: 'f13' });
    await waitFor(() => s.keyboard.events.length === 2);
    assert.equal(focus.calls.length, 0);
  });
});

/* ---------- The local panel never types into LibreShard itself ---------- */

// In the tests this process (node) plays LibreShard: isSelfApp compares with process.execPath
const SELF = { exe: path.basename(process.execPath), name: 'LibreShard', title: 'LibreShard' };
const OTHER = { exe: 'notepad.exe', name: 'Notepad', title: 'Untitled - Notepad' };

// Connects with a local device ("this PC") created on the server's device list
async function localPanel(s) {
  const { token } = s.devices.add('This PC', '127.0.0.1', { local: true });
  return authed({ port: s.port, token });
}

test('the local panel is blocked while LibreShard itself is in front, and only then', () => {
  const focus = fakeFocus({ ok: true }, SELF);
  return withServer({ focus }, async (s) => {
    const c = await localPanel(s);
    c.send({ type: 'press', shard: 'demo', keys: 'f13' });
    assert.deepEqual(await c.next(), { type: 'blocked', shard: 'demo', keys: 'f13', apps: [], active: '', reason: 'self' });
    c.send({ type: 'down', shard: 'demo', keys: 'shift' });
    assert.equal((await c.next()).reason, 'self');
    assert.equal(s.keyboard.events.length, 0);

    // Releasing still works, so nothing is left stuck
    c.send({ type: 'up', shard: 'demo', keys: 'shift' });
    await waitFor(() => s.keyboard.events.length === 1);

    focus.app = OTHER;
    c.send({ type: 'press', shard: 'demo', keys: 'f13' });
    await waitFor(() => s.keyboard.events.length === 3);

    // A failed detection doesn't block for this reason
    focus.app = null;
    c.send({ type: 'press', shard: 'demo', keys: 'f13' });
    await waitFor(() => s.keyboard.events.length === 5);
  });
});

test('tablets are blocked too while LibreShard itself is in front', () => {
  const focus = fakeFocus({ ok: true }, SELF);
  return withServer({ focus }, async (s) => {
    const c = await authed(s);
    c.send({ type: 'press', shard: 'demo', keys: 'f13' });
    assert.deepEqual(await c.next(), { type: 'blocked', shard: 'demo', keys: 'f13', apps: [], active: '', reason: 'self' });
    c.send({ type: 'down', shard: 'demo', keys: 'shift' });
    assert.equal((await c.next()).reason, 'self');
    assert.equal(s.keyboard.events.length, 0);

    // Releasing is never blocked
    c.send({ type: 'up', shard: 'demo', keys: 'shift' });
    await waitFor(() => s.keyboard.events.length === 1);

    focus.app = OTHER;
    c.send({ type: 'press', shard: 'demo', keys: 'f13' });
    await waitFor(() => s.keyboard.events.length === 3);
  });
});

// A real non-loopback connection: the server listens everywhere and the client uses the LAN address
const lanAddress = Object.values(os.networkInterfaces()).flat().find((i) => i && i.family === 'IPv4' && !i.internal)?.address;
test('the local device is refused from any address but loopback', { skip: !lanAddress && 'no LAN address' }, () => {
  const devices = new Devices(null);
  const { token } = devices.add('This PC', '127.0.0.1', { local: true });
  return withServer({ devices, host: '0.0.0.0' }, async (s) => {
    const WebSocket = require('ws');
    const ws = new WebSocket(`ws://${lanAddress}:${s.port}/ws`, { origin: `http://${lanAddress}:${s.port}` });
    // A device that gets in is never closed: give up after a while instead of waiting forever
    const closed = new Promise((resolve) => {
      ws.on('close', (code) => resolve(code));
      setTimeout(() => { resolve('still open'); ws.terminate(); }, 2000);
    });
    await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
    ws.send(JSON.stringify({ type: 'auth', token }));
    assert.equal(await closed, 4001);
    // The same token works from this machine
    assert.ok(await authed({ port: s.port, token }));
  });
});

test('releasing a key is never blocked', () => {
  const focus = fakeFocus({ ok: false, reason: 'wrong-app', active: 'Other' });
  return withServer({ focus }, async (s) => {
    const c = await authed(s);
    c.send({ type: 'up', shard: 'restricted', keys: 'b' });
    await waitFor(() => s.keyboard.events.length === 1);
    assert.deepEqual(s.keyboard.events, [release(Key.B)]);
  });
});

test('held combos are released when the connection drops', () => withServer({}, async (s) => {
  const c = await authed(s);
  c.send({ type: 'down', shard: 'demo', keys: 'shift' });
  await waitFor(() => s.keyboard.events.length === 1);
  c.ws.terminate();
  await waitFor(() => s.keyboard.events.length === 2);
  assert.deepEqual(s.keyboard.events, [press(Key.LeftShift), release(Key.LeftShift)]);
}));

test('releaseAll lets go of everything held and stops typing', () => withServer({}, async (s) => {
  const c = await authed(s);
  c.send({ type: 'down', shard: 'demo', keys: 'shift' });
  await waitFor(() => s.keyboard.events.length === 1);
  await s.server.releaseAll();
  assert.deepEqual(s.keyboard.events, [press(Key.LeftShift), release(Key.LeftShift)]);
  c.send({ type: 'press', shard: 'demo', keys: 'f13' });
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(s.keyboard.events.length, 2);
}));

/* ---------- Protocol limits ---------- */

test('oversized messages close the connection', () => withServer({}, async (s) => {
  const c = await authed(s);
  c.send(JSON.stringify({ type: 'press', shard: 'demo', keys: 'x'.repeat(5000) }));
  assert.equal(await c.closed, 1009);
}));

test('key messages above the rate limit are dropped', () => withServer({}, async (s) => {
  const c = await authed(s);
  // The bucket refills with the clock, so on a slow machine more messages would get through. With
  // the clock frozen (a second ahead, so the bucket starts full) exactly RATE (50) are answered.
  const realNow = Date.now;
  const frozen = realNow() + 1000;
  Date.now = () => frozen;
  try {
    for (let i = 0; i < 90; i++) c.send({ type: 'press', shard: 'demo', keys: 'win+r' });
    const denied = () => c.inbox.filter((m) => m.type === 'denied').length;
    for (let i = 0; i < 300 && denied() < 50; i++) await new Promise((r) => setTimeout(r, 10));
    await new Promise((r) => setTimeout(r, 200)); // nothing else may arrive
    assert.equal(denied(), 50);
  } finally {
    Date.now = realNow;
  }
}));

test("'up' is never dropped by the rate limit", () => withServer({}, async (s) => {
  const c = await authed(s);
  for (let i = 0; i < 80; i++) c.send({ type: 'up', shard: 'demo', keys: 'f13' });
  await waitFor(() => s.keyboard.events.length === 80, 3000);
}));

// A flood is more queued messages than the server can handle, not a rate: with an instant fake
// keyboard a slow machine could drain the queue between network reads. A keyboard that takes 50 ms
// per key keeps the queue growing on any machine.
const slowKeyboard = () => {
  const wait = () => new Promise((r) => setTimeout(r, 50));
  return { events: [], pressKey: wait, releaseKey: wait };
};

test('a flood of messages disconnects the client', () => withServer({ keyboard: slowKeyboard() }, async (s) => {
  const c = await authed(s);
  for (let i = 0; i < 150; i++) c.send({ type: 'up', shard: 'demo', keys: 'f13' });
  assert.equal(await c.closed, 1008);
}));

test('no more than 10 combos can be held at once', () => withServer({}, async (s) => {
  const c = await authed(s);
  for (const k of 'abcdefghij') c.send({ type: 'down', shard: 'demo', keys: k });
  c.send({ type: 'down', shard: 'demo', keys: 'k' });
  assert.deepEqual(await c.next(), { type: 'error', code: 'too-many-held' });
  assert.equal(s.keyboard.events.length, 10);
}));

/* ---------- Shards and files ---------- */

test('/api/shards lists valid shards with their effective apps', () => withServer({}, async ({ base }) => {
  const list = await (await fetch(base + '/api/shards')).json();
  const byId = Object.fromEntries(list.map((s) => [s.id, s]));
  assert.deepEqual(Object.keys(byId).sort(), ['demo', 'linked', 'restricted']);
  assert.deepEqual(byId.demo.apps, []);
  assert.deepEqual(byId.restricted.apps, ['photoshop']);
}));

test('invalid shards are skipped with their reasons', () => withServer({}, async ({ server }) => {
  const reasons = Object.fromEntries(server.store.rejected.map((r) => [path.basename(r.root), r.errors.join(' ')]));
  assert.match(reasons['bad-id'], /"id"/);
  assert.match(reasons['bad-key'], /unknown key "ctrl\+banana"/);
  assert.match(reasons['bad-json'], /not valid JSON/);
}));

test('with a repeated id the first shard wins', async () => {
  const dupDir = makeShardDir({ 'demo-copy': { manifest: { id: 'demo', permissions: { keys: ['f13'] } }, files: { 'index.html': 'impostor' } } });
  try {
    await withServer({ shardDirs: [shardDir, dupDir] }, async ({ port, server }) => {
      assert.match((await rawGet(port, '/shards/demo/index.html')).body, /data-key="f13"/);
      assert.ok(server.store.rejected.some((r) => r.root.endsWith('demo-copy') && /already used/.test(r.errors[0])));
    });
  } finally {
    fs.rmSync(dupDir, { recursive: true, force: true });
  }
});

test('shard index.html gets the API injected and a strict CSP', () => withServer({}, async ({ port }) => {
  const r = await rawGet(port, '/shards/demo/index.html');
  assert.equal(r.status, 200);
  assert.match(r.body, /<script src="\/shard-api\.js"><\/script>\s*$/);
  const csp = r.headers['content-security-policy'];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /frame-ancestors 'self'/);

  const css = await rawGet(port, '/shards/demo/style.css');
  assert.equal(css.status, 200);
  assert.equal(css.body, 'button{}');
}));

test('shard files cannot escape their folder', () => withServer({}, async ({ port }) => {
  for (const p of [
    '/shards/demo/../restricted/manifest.json',
    '/shards/demo/../../package.json',
    '/shards/demo/..%2f..%2fpackage.json',
    '/shards/demo/escape/secret.txt', // a link inside the shard pointing outside
    '/shards/demo/.secret', // dotfiles
    '/shards/demo/missing.css',
    '/shards/nope/index.html',
  ]) {
    assert.equal((await rawGet(port, p)).status, 404, p);
  }
}));

test('a shard whose folder is a link still loads', () => withServer({}, async ({ port }) => {
  const r = await rawGet(port, '/shards/linked/index.html');
  assert.equal(r.status, 200);
  assert.match(r.body, /^linked shard/);
}));

/* ---------- Rules ---------- */

test('user rules replace the manifest apps, and mode "any" removes the restriction', async () => {
  const rulesFile = path.join(os.tmpdir(), `libreshard-rules-${process.pid}.json`);
  fs.writeFileSync(rulesFile, JSON.stringify({ restricted: { mode: 'any' }, demo: { mode: 'only', apps: [{ match: 'krita' }] } }));
  try {
    await withServer({ rulesFile }, async ({ base }) => {
      const list = await (await fetch(base + '/api/shards')).json();
      const byId = Object.fromEntries(list.map((s) => [s.id, s]));
      assert.deepEqual(byId.restricted.apps, []);
      assert.deepEqual(byId.demo.apps, ['krita']);
    });
  } finally {
    fs.rmSync(rulesFile, { force: true });
  }
});

test('loadRules rejects invalid files and resolveApps prefers user rules', () => {
  const bad = path.join(os.tmpdir(), `libreshard-bad-${process.pid}.json`);
  try {
    fs.writeFileSync(bad, '{ not json');
    assert.throws(() => loadRules(bad));
    fs.writeFileSync(bad, '["photoshop"]');
    assert.throws(() => loadRules(bad), /object/);
  } finally {
    fs.rmSync(bad, { force: true });
  }
  const shard = { manifest: { id: 'x', apps: ['photoshop'] } };
  assert.deepEqual(resolveApps(shard.manifest, new Map()), [{ match: 'photoshop' }]);
  assert.deepEqual(resolveApps(shard.manifest, new Map([['x', { mode: 'only', apps: [{ exe: 'gimp.exe', name: 'GIMP' }] }]])), [{ exe: 'gimp.exe', name: 'GIMP' }]);
  assert.deepEqual(resolveApps(shard.manifest, new Map([['x', { mode: 'any', apps: [] }]])), []);
});

test('startServer rejects with EADDRINUSE when the port is taken', () => withServer({}, async (s) => {
  await assert.rejects(
    startServer({ port: s.port, host: '127.0.0.1', shardDirs: [shardDir], keyboard: s.keyboard, focus: s.focus }),
    { code: 'EADDRINUSE' },
  );
}));

/* ---------- Approvals, pause, confirmation and live updates ---------- */

// A store where "demo" is a user shard (needs approval) instead of a bundled one
function userStore() {
  const state = path.join(os.tmpdir(), `libreshard-state-${process.pid}-${Date.now()}.json`);
  const store = new ShardStore({ dirs: [{ dir: shardDir, bundled: false }], installDir: shardDir, stateFile: state });
  return { store, cleanup: () => fs.rmSync(state, { force: true }) };
}

test('keys of a user shard are denied until the user approves them', async () => {
  const { store, cleanup } = userStore();
  try {
    await withServer({ store }, async (s) => {
      const list = await (await fetch(s.base + '/api/shards')).json();
      assert.equal(list.find((x) => x.id === 'demo').pending, true);
      const c = await authed(s);
      c.send({ type: 'press', shard: 'demo', keys: 'f13' });
      assert.deepEqual(await c.next(), { type: 'denied', shard: 'demo', keys: 'f13' });

      store.approve('demo');
      assert.deepEqual(await c.next(), { type: 'shards-changed' });
      c.send({ type: 'press', shard: 'demo', keys: 'f13' });
      await waitFor(() => s.keyboard.events.length === 2);
    });
  } finally { cleanup(); }
});

test('disabled shards are neither listed nor served', async () => {
  const { store, cleanup } = userStore();
  try {
    store.setEnabled('demo', false);
    await withServer({ store }, async (s) => {
      const list = await (await fetch(s.base + '/api/shards')).json();
      assert.ok(!list.some((x) => x.id === 'demo'));
      assert.equal((await rawGet(s.port, '/shards/demo/index.html')).status, 404);
    });
  } finally { cleanup(); }
});

test('pausing releases held keys, ignores presses but still lets keys go', () => withServer({}, async (s) => {
  const c = await authed(s);
  c.send({ type: 'down', shard: 'demo', keys: 'shift' });
  await waitFor(() => s.keyboard.events.length === 1);
  await s.server.setPaused(true);
  assert.deepEqual(await c.next(), { type: 'paused', value: true });
  assert.deepEqual(s.keyboard.events, [press(Key.LeftShift), release(Key.LeftShift)]);

  c.send({ type: 'press', shard: 'demo', keys: 'f13' });
  c.send({ type: 'up', shard: 'demo', keys: 'f13' });
  await waitFor(() => s.keyboard.events.length === 3);
  await new Promise((r) => setTimeout(r, 150));
  assert.deepEqual(s.keyboard.events.slice(2), [release(Key.F13)], 'only the release went through');

  // A tablet connecting while paused learns it right away
  const late = connect(s.port);
  await late.opened;
  late.send({ type: 'auth', token: s.token });
  assert.equal((await late.next()).paused, true);

  await s.server.setPaused(false);
  assert.deepEqual(await c.next(), { type: 'paused', value: false });
  c.send({ type: 'press', shard: 'demo', keys: 'f13' });
  await waitFor(() => s.keyboard.events.length === 5);
}));

test('with confirmation on, a new device waits for the PC and can be accepted', () => {
  let answer;
  const asked = [];
  const confirmPairing = (info) => { asked.push(info); return new Promise((r) => { answer = r; }); };
  return withServer({ confirmPairing }, async (s) => {
    const c = connect(s.port);
    await c.opened;
    c.send({ type: 'pair', code: s.pairing.current().code, name: 'iPad · Safari' });
    assert.deepEqual(await c.next(), { type: 'pending' });
    assert.equal(asked.length, 1);
    assert.equal(asked[0].name, 'iPad · Safari');
    assert.equal(asked[0].ip, '127.0.0.1');
    assert.equal(asked[0].signal.aborted, false, 'the question stays open while the tablet waits');
    assert.equal(s.devices.all().length, 1, 'not added before the answer');
    answer(true);
    const paired = await c.next();
    assert.equal(paired.type, 'paired');
    assert.equal(s.devices.all().length, 2);
  });
});

test('with confirmation on, a rejected device is closed with 4003', () => {
  const confirmPairing = () => Promise.resolve(false);
  return withServer({ confirmPairing }, async (s) => {
    const c = connect(s.port);
    await c.opened;
    c.send({ type: 'pair', code: s.pairing.current().code });
    assert.deepEqual(await c.next(), { type: 'pending' });
    assert.deepEqual(await c.next(), { type: 'error', code: 'pair-rejected' });
    assert.equal(await c.closed, 4003);
    assert.equal(s.devices.all().length, 1);
  });
});

test('the question on the PC is closed when the tablet gives up waiting', () => {
  let signal;
  const confirmPairing = (info) => { signal = info.signal; return new Promise(() => {}); }; // never answered
  return withServer({ confirmPairing }, async (s) => {
    const c = connect(s.port);
    await c.opened;
    c.send({ type: 'pair', code: s.pairing.current().code });
    assert.deepEqual(await c.next(), { type: 'pending' });
    assert.equal(signal.aborted, false);
    c.ws.terminate();
    await waitFor(() => signal.aborted);
    assert.equal(s.devices.all().length, 1, 'no device added');
  });
});

test('the question on the PC is closed when the time runs out, and the tablet is rejected', () => {
  let signal;
  const confirmPairing = (info) => { signal = info.signal; return new Promise(() => {}); };
  return withServer({ confirmPairing, confirmTimeoutMs: 100 }, async (s) => {
    const c = connect(s.port);
    await c.opened;
    c.send({ type: 'pair', code: s.pairing.current().code });
    assert.deepEqual(await c.next(), { type: 'pending' });
    assert.deepEqual(await c.next(), { type: 'error', code: 'pair-rejected' });
    assert.equal(await c.closed, 4003);
    assert.equal(signal.aborted, true);
    assert.equal(s.devices.all().length, 1);
  });
});

test('confirmPairing returning true pairs right away without "pending"', () => withServer({ confirmPairing: () => true }, async (s) => {
  const c = connect(s.port);
  await c.opened;
  c.send({ type: 'pair', code: s.pairing.current().code });
  assert.equal((await c.next()).type, 'paired');
}));


/* ---------- "Allow here too" from the tablet ---------- */

function rulesStore() {
  const rulesFile = path.join(os.tmpdir(), `libreshard-allow-${process.pid}-${Date.now()}.json`);
  const store = new ShardStore({ dirs: [{ dir: shardDir, bundled: true }], rulesFile });
  return { store, rulesFile, cleanup: () => fs.rmSync(rulesFile, { force: true }) };
}
const spotify = { exe: 'Spotify.exe', name: 'Spotify', path: 'C:\\S\\Spotify.exe' };

test('a block offers "allow here too", and accepting adds the program the PC detected', async () => {
  const { store, rulesFile, cleanup } = rulesStore();
  const focus = fakeFocus({ ok: false, reason: 'wrong-app', active: 'Spotify (Spotify.exe)', app: spotify });
  try {
    await withServer({ store, focus, allowAppsFromTablet: () => true }, async (s) => {
      const c = await authed(s);
      c.send({ type: 'press', shard: 'restricted', keys: 'b' });
      const blocked = await c.next();
      assert.equal(blocked.canAllow, true);
      assert.equal(blocked.app, 'Spotify');
      c.send({ type: 'allow-app', shard: 'restricted', exe: 'evil.exe' }); // an exe from the tablet is ignored
      const replies = [await c.next(), await c.next()]; // 'allowed' and the store's 'shards-changed', in any order
      assert.deepEqual(replies.find((m) => m.type === 'allowed'), { type: 'allowed', shard: 'restricted', app: 'Spotify' });
      assert.ok(replies.some((m) => m.type === 'shards-changed'));
      assert.deepEqual(store.get('restricted').apps.map((a) => a.exe || a.match), ['photoshop', 'Spotify.exe']);
      assert.ok(fs.readFileSync(rulesFile, 'utf8').includes('Spotify.exe'));
      assert.ok(!fs.readFileSync(rulesFile, 'utf8').includes('evil'));

      // It works once per block
      c.send({ type: 'allow-app', shard: 'restricted' });
      assert.deepEqual(await c.next(), { type: 'error', code: 'allow-failed' });
    });
  } finally { cleanup(); }
});

test('"allow here too" is refused when the setting is off, without a block, or for another shard', async () => {
  const { store, cleanup } = rulesStore();
  const focus = fakeFocus({ ok: false, reason: 'wrong-app', active: 'Spotify', app: spotify });
  try {
    await withServer({ store, focus, allowAppsFromTablet: false }, async (s) => {
      const c = await authed(s);
      c.send({ type: 'press', shard: 'restricted', keys: 'b' });
      const blocked = await c.next();
      assert.equal(blocked.canAllow, undefined);
      c.send({ type: 'allow-app', shard: 'restricted' });
      assert.deepEqual(await c.next(), { type: 'error', code: 'allow-failed' });
    });
    await withServer({ store, focus, allowAppsFromTablet: true }, async (s) => {
      const c = await authed(s);
      c.send({ type: 'allow-app', shard: 'restricted' });
      assert.deepEqual(await c.next(), { type: 'error', code: 'allow-failed' }, 'no block yet');
      c.send({ type: 'press', shard: 'restricted', keys: 'b' });
      await c.next();
      c.send({ type: 'allow-app', shard: 'demo' });
      assert.deepEqual(await c.next(), { type: 'error', code: 'allow-failed' }, 'not the blocked shard');
    });
    assert.deepEqual(store.get('restricted').apps, [{ match: 'photoshop' }]);
  } finally { cleanup(); }
});

test('title-only detection never offers "allow here too"', async () => {
  const { store, cleanup } = rulesStore();
  const focus = fakeFocus({ ok: false, reason: 'wrong-app', active: 'Some window', app: null });
  try {
    await withServer({ store, focus, allowAppsFromTablet: true }, async (s) => {
      const c = await authed(s);
      c.send({ type: 'press', shard: 'restricted', keys: 'b' });
      assert.equal((await c.next()).canAllow, undefined);
    });
  } finally { cleanup(); }
});

test('keys missing from the keyboard map are refused instead of pressed', () => withServer({ unavailableKeys: (combo) => (combo.includes('f13') ? ['f13'] : []) }, async (s) => {
  const c = await authed(s);
  c.send({ type: 'press', shard: 'demo', keys: 'f13' });
  assert.deepEqual(await c.next(), { type: 'error', code: 'key-unavailable', keys: 'f13' });
  c.send({ type: 'up', shard: 'demo', keys: 'f13' });
  assert.deepEqual(await c.next(), { type: 'error', code: 'key-unavailable', keys: 'f13' });
  assert.equal(s.keyboard.events.length, 0);
  c.send({ type: 'press', shard: 'demo', keys: 'shift' });
  await waitFor(() => s.keyboard.events.length === 2);
}));

test('/api/strings gives the viewer its strings in the right language', () => withServer({}, async ({ base }) => {
  const es = await (await fetch(base + '/api/strings?lang=es-MX')).json();
  assert.equal(es.locale, 'es');
  assert.equal(es.strings['viewer.title'], 'Tus shards');
  assert.ok(Object.keys(es.strings).every((k) => k.startsWith('viewer.')), 'only viewer strings');
  assert.equal((await (await fetch(base + '/api/strings?lang=fr-FR')).json()).locale, 'en');
  assert.equal((await (await fetch(base + '/api/strings')).json()).locale, 'en');
}));

test('/api/strings follows the language chosen on the PC', () => withServer({ language: () => 'es' }, async ({ base }) => {
  const r = await (await fetch(base + '/api/strings?lang=en-US')).json();
  assert.equal(r.locale, 'es');
  assert.equal(r.shardLang, 'es', 'shards follow the PC choice too');
}));

test('/api/strings tells shards their language and the PC system', () => withServer({ platform: 'linux' }, async ({ base }) => {
  const fr = await (await fetch(base + '/api/strings?lang=fr-FR')).json();
  assert.equal(fr.locale, 'en', 'the viewer has no French');
  assert.equal(fr.shardLang, 'fr-fr', 'a shard may have it');
  assert.equal(fr.platform, 'linux');
  const odd = await (await fetch(base + '/api/strings?lang=' + encodeURIComponent('"><x'))).json();
  assert.equal(odd.shardLang, 'en', 'anything that is not a language tag falls back');
}));

/* ---------- Settings, development reloads and the live indicator ---------- */

test('settings changes and development file changes reach the tablets', async () => {
  const { store, cleanup } = userStore();
  try {
    await withServer({ store }, async (s) => {
      const c = await authed(s);
      store.emit('settings', 'demo', { mode: 'b' });
      assert.deepEqual(await c.next(), { type: 'settings', shard: 'demo', values: { mode: 'b' } });
      store.emit('files', 'demo');
      assert.deepEqual(await c.next(), { type: 'shard-files-changed', shard: 'demo' });
    });
  } finally { cleanup(); }
});

test('the live indicator reports a restricted shard as paused or active, only on changes', () => {
  const focus = fakeFocus({ ok: false, reason: 'wrong-app', active: 'Spotify' });
  return withServer({ focus }, async (s) => {
    const c = await authed(s);
    c.send({ type: 'open', shard: 'restricted' });
    assert.deepEqual(await c.next(), { type: 'focus', shard: 'restricted', ok: false, active: 'Spotify', apps: ['photoshop'] });
    focus.result = { ok: true };
    assert.deepEqual(await c.next(2000), { type: 'focus', shard: 'restricted', ok: true, active: '', apps: ['photoshop'] });
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(c.inbox.length, 0, 'nothing new while nothing changes');

    // Back to the menu, or a shard without apps: no more checks
    c.send({ type: 'open', shard: null });
    await new Promise((r) => setTimeout(r, 100));
    const calls = focus.calls.length;
    focus.result = { ok: false, reason: 'wrong-app', active: 'Other' };
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(focus.calls.length, calls, 'polling stopped');
    c.send({ type: 'open', shard: 'demo' });
    await new Promise((r) => setTimeout(r, 700));
    assert.equal(focus.calls.length, calls, 'shards without apps are never checked');
  });
});

test('/api/shards follows the menu order and marks favorites', async () => {
  const { store, cleanup } = userStore();
  try {
    store.setFavorite('restricted', true);
    await withServer({ store }, async ({ base }) => {
      const list = await (await fetch(base + '/api/shards')).json();
      assert.equal(list[0].id, 'restricted');
      assert.equal(list[0].favorite, true);
      assert.ok(list.slice(1).every((s) => s.favorite === false));
    });
  } finally { cleanup(); }
});

test('the log records pairings and blocks without device names, addresses or keys', () => {
  const lines = [];
  const add = (level) => (event, details = {}) => lines.push({ level, event, details });
  const log = { info: add('info'), warn: add('warn'), error: add('error') };
  const focus = fakeFocus({ ok: false, reason: 'wrong-app', active: 'Spotify (Spotify.exe)' });
  return withServer({ log, focus }, async (s) => {
    const p = connect(s.port);
    await p.opened;
    p.send({ type: 'pair', code: s.pairing.current().code, name: 'Secret Tablet' });
    const paired = await p.next();
    p.send({ type: 'press', shard: 'demo', keys: 'ctrl+alt+x' }); // undeclared: denied
    await p.next();
    p.send({ type: 'press', shard: 'restricted', keys: 'b' });
    await p.next();

    assert.deepEqual(lines.map((l) => l.event), ['device-paired', 'denied', 'blocked']);
    assert.deepEqual(lines[0].details, { device: paired.device.id.slice(0, 6), confirmed: false });
    assert.equal(lines[2].details.reason, 'wrong-app');
    const text = JSON.stringify(lines);
    for (const secret of ['Secret Tablet', '127.0.0.1', 'ctrl+alt+x', 'Spotify', paired.token]) {
      assert.ok(!text.includes(secret), `the log must not contain ${secret}`);
    }
  });
});
