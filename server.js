const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const { rateLimit } = require('express-rate-limit');
const { parse, normalize, unavailable } = require('./keys');
const { hostAllowed, isLoopback, isPrivateAddress } = require('./net');
const { Pairing, Devices, RateLimiter, cleanName } = require('./pairing');
const { ShardStore } = require('./shard-store');
const { appLabel, isSelfApp } = require('./focus/apps');
const i18n = require('./i18n');

// How long a 'press' is held down. Without it, press and release arrive at the same instant
// and games that read the keyboard once per frame (Star Citizen, for example) miss it.
const TAP_MS = 60;
const KEY_GAP_MS = 15; // between the keys of a combo, so the modifier lands first
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Protocol limits
const MAX_PAYLOAD = 4096; // bytes per WebSocket message
const MAX_CONNECTIONS = 32;
const AUTH_TIMEOUT_MS = 10000; // an unauthenticated socket is closed after this
const CONFIRM_TIMEOUT_MS = 60000; // how long a pairing waits for the user's answer on the PC
const RATE = 50; // key messages per second per connection ('up' is never dropped)
const MAX_PENDING = 100; // queued messages per connection before it's considered a flood
const MAX_HELD = 10; // combos held at once per connection
const MAX_FIELD = 64; // length of "shard" and "keys"
const ALLOW_WINDOW_MS = 60000; // how long after a block the tablet may answer "allow here too"
const FOCUS_POLL_MS = 500; // how often the foreground app is checked while a restricted shard is open
// HTTP requests per minute per address. A shard loads all its files at once and a tablet may open
// several in a row, so this is far above normal use; it only stops floods that would keep the
// file system busy.
const HTTP_RATE = 1000;

// WebSocket close codes the viewer understands
const CLOSE = { unknownDevice: 4001, pairingRejected: 4003, authTimeout: 4008, rateLimited: 4029 };

const SHARD_CSP = "default-src 'none'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; " +
  "img-src 'self' data:; font-src 'self' data:; connect-src 'none'; form-action 'none'; frame-ancestors 'self'";

// The viewer only loads its own files, talks to its own WebSocket and can't be framed by other sites
const viewerCsp = (host) => "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
  `img-src 'self' data:; media-src 'self'; connect-src 'self' ws://${host}; frame-src 'self'; ` +
  "frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'";

// Each key of the combo is pressed and released on its own (modifiers first, released last).
// nut-js pressKey(...several) is not used: it sends modifiers as "flags", sends RCtrl as the
// left Ctrl, and with several keys it can leave one stuck on release.
function makeTyper(keyboard) {
  return {
    async down(keys) {
      for (const [i, k] of keys.entries()) {
        if (i) await sleep(KEY_GAP_MS);
        await keyboard.pressKey(k);
      }
    },
    async up(keys) {
      for (const [i, k] of [...keys].reverse().entries()) {
        if (i) await sleep(KEY_GAP_MS);
        await keyboard.releaseKey(k);
      }
    },
  };
}

// The real keyboard, loaded only when no other one is injected (tests use a fake)
function nutKeyboard() {
  const { keyboard } = require('@nut-tree-fork/nut-js');
  keyboard.config.autoDelayMs = 0;
  return keyboard;
}

// What shards see as Shard.platform: 'windows', 'linux', 'mac' or the raw Node name
const shardPlatform = (p) => ({ win32: 'windows', linux: 'linux', darwin: 'mac' })[p] || p;
const LANG_TAG = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i;

const remoteIp = (req) => String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
const validField = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_FIELD;

// Resolves with the listening server, or rejects (EADDRINUSE, for example) if the port can't be used.
// - store: a ShardStore. Without one, `shardDirs` (+ `rulesFile`) are loaded as bundled shards.
// - keyboard, focus: injectable; by default nut-js and ./focus.
// - devices, pairing, limiter: default to in-memory instances (the app passes ones backed by files).
// - confirmPairing({ name, ip }): optional; return true to accept a new device right away, or a
//   promise of true/false to make the tablet wait for the user's answer on the PC.
// - allowAppsFromTablet: boolean or function; when true, a block offers "allow here too" and the
//   tablet may add the detected program to that shard's apps.
// - unavailableKeys(combo): keys this system can't press safely (keys.unavailable; injectable for tests).
// - language: 'auto' | 'es' | 'en', or a function returning it: the viewer's language (auto follows the tablet).
// - platform: the PC's system as shards see it (Shard.platform); defaults to this process's.
// - isSelf(app): whether a detected app is LibreShard itself (focus/apps isSelfApp; injectable for tests).
// - httpRate: HTTP requests per minute per address (HTTP_RATE; lower in tests).
// The returned server also has releaseAll(), setPaused(on) and isPaused().
function startServer({
  port, host = '0.0.0.0', store, shardDirs, rulesFile, appVersion,
  keyboard, focus, devices, pairing, limiter, allowPublic = false, onAlert, confirmPairing,
  allowAppsFromTablet = false, unavailableKeys = unavailable, language = 'auto',
  platform = shardPlatform(process.platform), isSelf = isSelfApp, httpRate = HTTP_RATE,
}) {
  const canAllow = () => (typeof allowAppsFromTablet === 'function' ? allowAppsFromTablet() : allowAppsFromTablet) === true;
  const typer = makeTyper(keyboard || nutKeyboard());
  focus = focus || require('./focus');
  devices = devices || new Devices(null);
  pairing = pairing || new Pairing();
  limiter = limiter || new RateLimiter();
  const ownStore = !store;
  store = store || new ShardStore({ dirs: (shardDirs || []).map((dir) => ({ dir, bundled: true })), rulesFile, appVersion });

  const app = express();
  app.disable('x-powered-by');
  const viewerDir = path.join(__dirname, 'viewer');

  // Only answer to the PC's own names and addresses (no DNS rebinding) and to private networks
  app.use((req, res, next) => {
    if (!hostAllowed(req.headers.host)) return res.status(403).send('Forbidden host');
    if (!allowPublic && !isPrivateAddress(remoteIp(req))) return res.status(403).send('Forbidden network');
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': viewerCsp(req.headers.host),
    });
    next();
  });

  // Every route reads files or the store. Each address is counted on its own: the server only
  // answers private networks, where grouping IPv6 addresses by subnet would merge all the tablets.
  app.use(rateLimit({ windowMs: 60000, limit: httpRate, ipv6Subnet: false, standardHeaders: 'draft-8', legacyHeaders: false }));

  app.get('/api/shards', (_req, res) => res.json(store.publicList()));

  // The viewer's strings: the language chosen on the PC, or else the tablet's (?lang=), or English
  app.get('/api/strings', (req, res) => {
    const preference = typeof language === 'function' ? language() : language;
    const locale = i18n.pickLocale(preference, String(req.query.lang || ''));
    const viewer = Object.entries(i18n.strings(locale)).filter(([k]) => k.startsWith('viewer.'));
    // Shards get the raw language (a shard may ship languages the app doesn't) and the PC's system
    const wanted = preference && preference !== 'auto' ? preference : String(req.query.lang || '');
    const shardLang = LANG_TAG.test(wanted) ? wanted.toLowerCase() : locale;
    res.json({ locale, strings: Object.fromEntries(viewer), shardLang, platform });
  });

  // Shard files: strict CSP (no network, no external resources), never outside the shard's folder
  app.get('/shards/:id/*', (req, res) => {
    const shard = store.get(req.params.id);
    if (!shard) return res.sendStatus(404);
    const rel = req.params[0] || 'index.html';
    if (rel.split(/[\\/]/).some((seg) => seg.startsWith('.'))) return res.sendStatus(404); // .., dotfiles
    const file = path.resolve(shard.root, rel);
    if (!file.startsWith(path.resolve(shard.root) + path.sep) || !fs.existsSync(file)) return res.sendStatus(404);
    // Links inside the folder could point anywhere: compare real paths. The root's own real path is
    // used, so a shard folder that is itself a link (a development junction) keeps working.
    const real = fs.realpathSync(file);
    if (!real.startsWith(shard.realRoot + path.sep) || !fs.statSync(real).isFile()) return res.sendStatus(404);
    res.set('Content-Security-Policy', SHARD_CSP);
    if (rel === 'index.html') {
      const html = fs.readFileSync(real, 'utf8') + '\n<script src="/shard-api.js"></script>';
      return res.type('html').send(html);
    }
    res.sendFile(real);
  });

  app.get('/shard-api.js', (_req, res) => {
    res.set('Content-Security-Policy', "default-src 'none'");
    res.sendFile(path.join(viewerDir, 'shard-api.js'));
  });
  app.use(express.static(viewerDir, { dotfiles: 'ignore' }));

  const server = http.createServer(app);
  const conns = new Set();
  let stopping = false;
  let paused = false;

  const broadcast = (obj) => {
    const data = JSON.stringify(obj);
    for (const c of conns) if (c.authed && c.ws.readyState === c.ws.OPEN) c.ws.send(data);
  };

  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: MAX_PAYLOAD,
    // Browsers always send Origin. It must be the viewer itself, served from an allowed host.
    verifyClient: ({ req, origin }, done) => {
      const h = req.headers.host;
      if (!hostAllowed(h) || origin !== `http://${h}`) return done(false, 403);
      if (!allowPublic && !isPrivateAddress(remoteIp(req))) return done(false, 403);
      if (conns.size >= MAX_CONNECTIONS) return done(false, 503);
      done(true);
    },
  });

  // A revoked device is disconnected at once; tablets refresh their menu when shards change
  const onRemoved = (id) => {
    for (const c of conns) if (c.device?.id === id) c.ws.close(CLOSE.unknownDevice, 'Device removed');
  };
  const onShards = () => { broadcast({ type: 'shards-changed' }); updateFocusPolling(); };
  const onSettings = (id, values) => broadcast({ type: 'settings', shard: id, values });
  const onFiles = (id) => broadcast({ type: 'shard-files-changed', shard: id });
  devices.on('removed', onRemoved);
  store.on('change', onShards);
  store.on('settings', onSettings);
  store.on('files', onFiles);
  const detach = () => {
    devices.off('removed', onRemoved);
    store.off('change', onShards);
    store.off('settings', onSettings);
    store.off('files', onFiles);
    clearInterval(focusTimer);
    focusTimer = null;
    if (ownStore) store.close();
  };

  // Live indicator: each tablet says which shard it has open ('open'). While any of them has a
  // shard limited to certain apps, the foreground app is checked every FOCUS_POLL_MS and each tablet
  // is told when its shard becomes active or paused ('focus'), only when that changes.
  let focusTimer = null;
  let polling = false;
  const restricted = (c) => {
    const shard = c.authed && c.open ? store.get(c.open) : null;
    return shard && shard.apps.length ? shard : null;
  };
  function updateFocusPolling() {
    const needed = [...conns].some(restricted);
    if (needed && !focusTimer) focusTimer = setInterval(pollFocus, FOCUS_POLL_MS);
    if (!needed && focusTimer) { clearInterval(focusTimer); focusTimer = null; }
  }
  async function pollFocus() {
    if (polling) return;
    polling = true;
    try {
      for (const c of conns) {
        const shard = restricted(c);
        if (!shard) continue;
        const r = await focus.check(shard.apps);
        const state = r.ok ? 'ok' : `${r.reason}:${r.active}`;
        if (c.focusState === state) continue;
        c.focusState = state;
        if (c.ws.readyState === c.ws.OPEN) {
          c.ws.send(JSON.stringify({ type: 'focus', shard: shard.id, ok: r.ok, active: r.active || '', apps: shard.apps.map(appLabel) }));
        }
      }
    } catch (e) {
      console.error(e.message);
    } finally {
      polling = false;
    }
  }
  server.on('close', detach);

  wss.on('connection', (ws, req) => {
    const c = { ws, ip: remoteIp(req), authed: false, device: null, held: new Set(), pending: 0, tokens: RATE, last: Date.now() };
    conns.add(c);
    const authTimer = setTimeout(() => { if (!c.authed) ws.close(CLOSE.authTimeout, 'Authentication timeout'); }, AUTH_TIMEOUT_MS);
    const send = (obj) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(obj));
    // Protocol errors (an oversized message, for example) are emitted here before ws closes the
    // socket. Without a listener, a single bad message would crash the whole app.
    ws.on('error', () => {});

    // Each connection's messages are handled in order: otherwise an 'up' (which doesn't wait
    // for focus.check) could run before its 'down' and leave the key stuck.
    let queue = Promise.resolve();
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (!msg || typeof msg !== 'object') return;

      // Token bucket: excess key messages are dropped, except 'up', which must always get through
      const now = Date.now();
      c.tokens = Math.min(RATE, c.tokens + ((now - c.last) * RATE) / 1000);
      c.last = now;
      if (msg.type !== 'up') {
        if (c.tokens < 1) return;
        c.tokens--;
      }
      if (++c.pending > MAX_PENDING) return ws.close(1008, 'Too many messages');
      queue = queue.then(() => handle(msg)).catch((e) => console.error(e.message)).finally(() => { c.pending--; });
    });

    // Held combos ('down' without its 'up') are released if the connection drops
    ws.on('close', () => {
      clearTimeout(authTimer);
      queue = queue.then(async () => {
        for (const combo of c.held) await typer.up(parse(combo)).catch(() => {});
        c.held.clear();
        conns.delete(c);
        updateFocusPolling();
      });
    });

    function authOk(device, extra = {}) {
      c.authed = true;
      c.device = device;
      clearTimeout(authTimer);
      send({ type: extra.token ? 'paired' : 'ok', device: { id: device.id, name: device.name }, paused, ...extra });
    }

    async function pair(msg) {
      const gate = limiter.check(c.ip);
      if (!gate.ok) {
        send({ type: 'error', code: 'rate-limited', retryAfter: gate.retryAfter });
        return ws.close(CLOSE.rateLimited, 'Too many attempts');
      }
      const attempt = typeof msg.token === 'string' ? { token: msg.token }
        : typeof msg.code === 'string' ? { code: msg.code } : {};
      if (!pairing.consume(attempt)) {
        if (limiter.fail(c.ip).alert && onAlert) onAlert({ ip: c.ip });
        send({ type: 'error', code: 'pair-failed' });
        return ws.close(CLOSE.unknownDevice, 'Invalid pairing code');
      }
      limiter.success(c.ip);
      const name = cleanName(msg.name);

      // Optional confirmation on the PC: the tablet waits (the auth timeout doesn't apply meanwhile)
      const decision = confirmPairing ? confirmPairing({ name, ip: c.ip }) : true;
      if (decision !== true) {
        clearTimeout(authTimer);
        send({ type: 'pending' });
        let timer;
        const accepted = await Promise.race([
          Promise.resolve(decision).catch(() => false),
          new Promise((r) => { timer = setTimeout(() => r(false), CONFIRM_TIMEOUT_MS); }),
        ]);
        clearTimeout(timer);
        if (ws.readyState !== ws.OPEN) return;
        if (accepted !== true) {
          send({ type: 'error', code: 'pair-rejected' });
          return ws.close(CLOSE.pairingRejected, 'Pairing rejected');
        }
      }
      const { device, token } = devices.add(name, c.ip);
      authOk(device, { token });
    }

    async function handle(msg) {
      if (!c.authed) {
        // A paired device: its token is 256 random bits, so failures aren't rate limited (and an
        // attacker can't lock real devices out by failing on purpose)
        if (msg.type === 'auth' && typeof msg.token === 'string') {
          const device = devices.verify(msg.token, c.ip);
          // The local panel's device only exists for this PC: from anywhere else it is unknown
          if (device && (!device.local || isLoopback(c.ip))) return authOk(device);
          return ws.close(CLOSE.unknownDevice, 'Unknown device');
        }
        if (msg.type === 'pair') return pair(msg);
        return ws.close(CLOSE.unknownDevice, 'Authentication required');
      }

      // The tablet opened a shard (or went back to the menu): drives the live indicator
      if (msg.type === 'open') {
        c.open = validField(msg.shard) ? msg.shard : null;
        c.focusState = null;
        updateFocusPolling();
        if (restricted(c)) pollFocus();
        return;
      }

      // "Allow here too" after a block: the program comes from what the PC detected, never from the message
      if (msg.type === 'allow-app') {
        const b = c.lastBlocked;
        if (!canAllow() || !b || b.shard !== msg.shard || Date.now() - b.at > ALLOW_WINDOW_MS) {
          return send({ type: 'error', code: 'allow-failed' });
        }
        c.lastBlocked = null;
        try { store.addApp(b.shard, b.app); } catch { return send({ type: 'error', code: 'allow-failed' }); }
        return send({ type: 'allowed', shard: b.shard, app: b.app.name });
      }

      if (stopping || !['press', 'down', 'up'].includes(msg.type)) return;
      if (!validField(msg.shard) || !validField(msg.keys)) return;
      // While paused nothing is pressed, but releasing is still allowed so no key stays down
      if (paused && msg.type !== 'up') return;
      const shard = store.get(msg.shard);
      if (!shard) return;
      const combo = normalize(msg.keys);
      // Validation lives here, in the agent: a shard can only use what it declared and the user approved.
      if (!shard.allowed.has(combo)) {
        return send({ type: 'denied', shard: msg.shard, keys: combo });
      }
      if (msg.type === 'down' && !c.held.has(combo) && c.held.size >= MAX_HELD) {
        return send({ type: 'error', code: 'too-many-held' });
      }
      // A key missing from this system's keyboard map would crash the app (see keys.unavailable).
      // It can't have been pressed, so there's nothing to release either.
      const missing = unavailableKeys(combo);
      if (missing.length) return send({ type: 'error', code: 'key-unavailable', keys: missing.join('+') });

      // The local panel runs on this PC: with LibreShard itself in front, its keys would land in the
      // app (reload, developer tools…). Tablets are left alone and get no extra detection. A failed
      // detection doesn't block here; the app check below still fails closed.
      if (msg.type !== 'up' && c.device.local && isSelf(await focus.active())) {
        return send({ type: 'blocked', shard: msg.shard, keys: combo, apps: [], active: '', reason: 'self' });
      }

      // If the shard is limited to certain apps, it only acts while one of them is in the foreground.
      // Releasing keys ('up') is never blocked, so no key is left stuck.
      if (msg.type !== 'up' && shard.apps.length) {
        const r = await focus.check(shard.apps);
        if (!r.ok) {
          const allowable = canAllow() && !!r.app?.exe;
          c.lastBlocked = allowable ? { shard: shard.id, app: r.app, at: Date.now() } : null;
          return send({
            type: 'blocked', shard: msg.shard, keys: combo,
            apps: shard.apps.map(appLabel), active: r.active, reason: r.reason,
            ...(allowable ? { canAllow: true, app: r.app.name } : {}),
          });
        }
      }

      try {
        const keys = parse(combo);
        if (msg.type === 'press') {
          try {
            await typer.down(keys);
            await sleep(TAP_MS);
          } finally {
            await typer.up(keys);
          }
        } else if (msg.type === 'down') {
          c.held.add(combo);
          await typer.down(keys);
        } else {
          c.held.delete(combo);
          await typer.up(keys);
        }
      } catch (e) {
        console.error(e.message);
      }
    }
  });

  const releaseHeld = async () => {
    for (const c of conns) {
      for (const combo of c.held) await typer.up(parse(combo)).catch(() => {});
      c.held.clear();
    }
  };

  // Releases every held combo on every connection and stops typing. Called before the app quits.
  server.releaseAll = async () => {
    stopping = true;
    await releaseHeld();
  };

  // Pausing releases whatever is held and tells every tablet
  server.setPaused = async (on) => {
    paused = !!on;
    if (paused) await releaseHeld();
    broadcast({ type: 'paused', value: paused });
  };
  server.isPaused = () => paused;
  server.store = store;

  // ws re-emits the HTTP server's errors on the WebSocketServer; without a listener they would crash
  // the process. Listen errors are reported through the returned promise instead.
  wss.on('error', () => {});

  return new Promise((resolve, reject) => {
    const fail = (e) => {
      detach();
      reject(e);
    };
    server.once('error', fail);
    server.listen(port, host, () => {
      server.off('error', fail);
      resolve(server);
    });
  });
}

module.exports = { startServer, CLOSE };
