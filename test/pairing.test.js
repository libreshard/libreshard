const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Pairing, Devices, RateLimiter, cleanName } = require('../pairing');

test('pairing codes are 6 digits and QR tokens are long and random', () => {
  const p = new Pairing();
  const a = p.current();
  assert.match(a.code, /^\d{6}$/);
  assert.ok(a.token.length >= 20);
  p.rotate();
  assert.notEqual(p.current().token, a.token);
  p.stop();
});

test('a code or token works once, and both rotate together', () => {
  const p = new Pairing();
  const changes = [];
  p.on('change', (c) => changes.push(c));
  const { code, token } = p.current();
  assert.ok(!p.consume({ code: 'wrong' }));
  assert.ok(!p.consume({}));
  assert.ok(p.consume({ code }));
  assert.equal(changes.length, 1);
  assert.ok(!p.consume({ code }), 'code used up');
  assert.ok(!p.consume({ token }), 'token rotated along with the code');
  assert.ok(p.consume({ token: p.current().token }));
  p.stop();
});

test('expired codes are refused and replaced', () => {
  let now = 1000;
  const p = new Pairing({ ttlMs: 60000, now: () => now });
  const { code, token } = p.current();
  now += 60001;
  assert.ok(!p.consume({ code }));
  assert.notEqual(p.current().token, token, 'a new token replaced the expired one');
  assert.ok(p.current().expiresAt > now);
  p.stop();
});

test('devices store only token hashes and survive a reload', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'libreshard-dev-')), 'devices.json');
  const d = new Devices(file);
  const { device, token } = d.add('iPad · Safari', '192.168.0.20');
  assert.equal(device.name, 'iPad · Safari');
  assert.ok(!fs.readFileSync(file, 'utf8').includes(token));
  assert.equal(device.tokenHash, undefined, 'public info has no hash');

  const reloaded = new Devices(file);
  assert.equal(reloaded.verify(token, '192.168.0.21').id, device.id);
  assert.equal(reloaded.verify(token + 'x'), null);
  assert.equal(reloaded.verify(''), null);
  assert.equal(reloaded.verify(42), null);
  assert.equal(reloaded.all()[0].lastIp, '192.168.0.21');
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
});

test('devices can be renamed and removed', () => {
  const d = new Devices(null);
  const events = [];
  d.on('removed', (id) => events.push(id));
  const { device, token } = d.add('A');
  assert.ok(d.rename(device.id, '  Tablet  '));
  assert.equal(d.all()[0].name, 'Tablet');
  assert.ok(d.remove(device.id));
  assert.deepEqual(events, [device.id]);
  assert.equal(d.verify(token), null);
  assert.ok(!d.remove(device.id));
});

test('device names are cleaned up', () => {
  assert.equal(cleanName('  iPad\u0000\n  '), 'iPad');
  assert.equal(cleanName(''), 'Dispositivo');
  assert.equal(cleanName({}), 'Dispositivo');
  assert.equal(cleanName('x'.repeat(100)).length, 60);
});

test('the rate limiter blocks an IP after 5 failures, doubling each time', () => {
  let now = 0;
  const r = new RateLimiter({ now: () => now, globalMax: 1000 });
  for (let i = 0; i < 4; i++) r.fail('1.1.1.1');
  assert.ok(r.check('1.1.1.1').ok);
  r.fail('1.1.1.1');
  assert.deepEqual(r.check('1.1.1.1'), { ok: false, retryAfter: 30, scope: 'ip' });
  assert.ok(r.check('2.2.2.2').ok, 'other IPs are not affected');

  now += 30000;
  assert.ok(r.check('1.1.1.1').ok);
  for (let i = 0; i < 5; i++) r.fail('1.1.1.1');
  assert.equal(r.check('1.1.1.1').retryAfter, 60);

  r.success('1.1.1.1');
  assert.ok(r.check('1.1.1.1').ok);
});

test('the block never exceeds the maximum', () => {
  let now = 0;
  const r = new RateLimiter({ now: () => now, globalMax: 1000, maxBlockMs: 90000 });
  for (let round = 0; round < 6; round++) {
    for (let i = 0; i < 5; i++) r.fail('ip');
    assert.ok(r.check('ip').retryAfter <= 90);
    now += 200000;
  }
});

test('too many failures overall pause pairing for everyone and alert once', () => {
  let now = 0;
  const r = new RateLimiter({ now: () => now, maxFailures: 100, globalMax: 3, globalPauseMs: 60000 });
  const alerts = [1, 2, 3, 4, 5].map((i) => r.fail('10.0.0.' + i).alert);
  assert.deepEqual(alerts, [false, false, false, true, false]);
  assert.deepEqual(r.check('10.0.0.99'), { ok: false, retryAfter: 60, scope: 'global' });
  now += 60000;
  assert.ok(r.check('10.0.0.99').ok);
});
