// Device pairing. There is no permanent PIN: the PC shows a short-lived pairing code (and a QR with a
// one-time token), and each paired device gets its own random token. Only the token's SHA-256 hash is
// stored, so devices.json is useless to whoever reads it, and any device can be revoked on its own.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest();

// Constant-time comparison of two strings (different lengths simply don't match)
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// The current pairing code and QR token. Both expire after `ttlMs` or once used, and rotate together.
// Emits 'change' on every rotation so the PC window can show the new ones.
class Pairing extends EventEmitter {
  constructor({ ttlMs = 10 * 60 * 1000, now = Date.now } = {}) {
    super();
    this.ttlMs = ttlMs;
    this.now = now;
    this.timer = null;
    this.rotate();
  }

  rotate() {
    this.token = crypto.randomBytes(16).toString('base64url');
    this.code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
    this.expiresAt = this.now() + this.ttlMs;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.rotate(), this.ttlMs);
    this.timer.unref?.();
    this.emit('change', this.current());
  }

  current() {
    if (this.now() >= this.expiresAt) this.rotate();
    return { token: this.token, code: this.code, expiresAt: this.expiresAt };
  }

  // { token } from the QR or { code } typed by hand. A successful pairing uses both up.
  consume({ token, code } = {}) {
    if (this.now() >= this.expiresAt) {
      this.rotate();
      return false;
    }
    const ok = (token !== undefined && safeEqual(token, this.token)) ||
      (code !== undefined && safeEqual(code, this.code));
    if (ok) this.rotate();
    return ok;
  }

  stop() { clearTimeout(this.timer); }
}

// Paired devices, saved in a JSON file: [{ id, name, tokenHash, createdAt, lastSeen, lastIp, local? }].
// `local` marks the panel that runs inside the app on this PC; there is at most one.
// Emits 'change' when a device is added, renamed or removed, and 'removed' (with the id) on removal.
class Devices extends EventEmitter {
  constructor(file) {
    super();
    this.file = file;
    this.list = [];
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(raw)) this.list = raw.filter((d) => d && typeof d.tokenHash === 'string' && typeof d.id === 'string');
    } catch { /* no devices yet */ }
  }

  save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.list, null, 2) + '\n');
  }

  // Returns the new device's public info and its token, which is only ever given to that device.
  // A new local device replaces the previous one (its token can't be recovered: only hashes are kept).
  add(name, ip, { local = false } = {}) {
    if (local) for (const d of this.list.filter((x) => x.local)) this.remove(d.id);
    const token = crypto.randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    const device = {
      id: crypto.randomBytes(8).toString('hex'),
      name: cleanName(name),
      tokenHash: sha256(token).toString('hex'),
      createdAt: now,
      lastSeen: now,
      lastIp: String(ip || ''),
      ...(local ? { local: true } : {}),
    };
    this.list.push(device);
    this.save();
    this.emit('change');
    return { device: publicInfo(device), token };
  }

  // The device that owns `token`, or null. Every stored hash is compared in constant time.
  verify(token, ip) {
    if (typeof token !== 'string' || token.length > 200) return null;
    const hash = sha256(token);
    let found = null;
    for (const d of this.list) {
      const stored = Buffer.from(d.tokenHash, 'hex');
      if (stored.length === hash.length && crypto.timingSafeEqual(stored, hash)) found = d;
    }
    if (!found) return null;
    found.lastSeen = new Date().toISOString();
    found.lastIp = String(ip || '');
    this.save();
    return publicInfo(found);
  }

  rename(id, name) {
    const d = this.list.find((x) => x.id === id);
    if (!d) return false;
    d.name = cleanName(name);
    this.save();
    this.emit('change');
    return true;
  }

  remove(id) {
    const before = this.list.length;
    this.list = this.list.filter((d) => d.id !== id);
    if (this.list.length === before) return false;
    this.save();
    this.emit('removed', id);
    this.emit('change');
    return true;
  }

  all() { return this.list.map(publicInfo); }
}

const publicInfo = ({ id, name, createdAt, lastSeen, lastIp, local }) => ({ id, name, createdAt, lastSeen, lastIp, local: local === true });

// Device names come from the tablet: plain text, trimmed and short
function cleanName(name) {
  const s = typeof name === 'string' ? name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) : '';
  return s || 'Dispositivo';
}

// Limits failed pairing attempts. Per IP: after `maxFailures` failures the IP waits `baseBlockMs`,
// doubling on each new block up to `maxBlockMs`. Globally: more than `globalMax` failures within
// `globalWindowMs` pause pairing for everyone for `globalPauseMs` and raise an alert.
class RateLimiter {
  constructor({
    maxFailures = 5, baseBlockMs = 30000, maxBlockMs = 15 * 60000,
    globalMax = 20, globalWindowMs = 60000, globalPauseMs = 60000, now = Date.now,
  } = {}) {
    Object.assign(this, { maxFailures, baseBlockMs, maxBlockMs, globalMax, globalWindowMs, globalPauseMs, now });
    this.ips = new Map();
    this.recent = [];
    this.pausedUntil = 0;
  }

  // { ok: true } or { ok: false, retryAfter: seconds, scope: 'ip' | 'global' }
  check(ip) {
    const t = this.now();
    if (t < this.pausedUntil) return { ok: false, retryAfter: Math.ceil((this.pausedUntil - t) / 1000), scope: 'global' };
    const s = this.ips.get(ip);
    if (s && t < s.blockedUntil) return { ok: false, retryAfter: Math.ceil((s.blockedUntil - t) / 1000), scope: 'ip' };
    return { ok: true };
  }

  // Records a failure. Returns { alert: true } the moment the global threshold is crossed.
  fail(ip) {
    const t = this.now();
    const s = this.ips.get(ip) || { failures: 0, blocks: 0, blockedUntil: 0 };
    s.failures++;
    if (s.failures >= this.maxFailures) {
      s.blocks++;
      s.failures = 0;
      s.blockedUntil = t + Math.min(this.baseBlockMs * 2 ** (s.blocks - 1), this.maxBlockMs);
    }
    this.ips.set(ip, s);

    this.recent = this.recent.filter((x) => t - x < this.globalWindowMs);
    this.recent.push(t);
    if (this.recent.length > this.globalMax && t >= this.pausedUntil) {
      this.pausedUntil = t + this.globalPauseMs;
      this.recent = [];
      return { alert: true };
    }
    return { alert: false };
  }

  success(ip) { this.ips.delete(ip); }
}

module.exports = { Pairing, Devices, RateLimiter, cleanName, safeEqual };
