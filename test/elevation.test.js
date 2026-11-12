const test = require('node:test');
const assert = require('node:assert/strict');
const { createElevation } = require('../focus/elevation');

const MEDIUM = 0x2000;
const HIGH = 0x3000;

// A fake Windows API: our own level, and each pid's level (missing pid → access denied → null)
const fakeApi = (own, levels) => () => ({
  ownLevel: () => own,
  processLevel: (pid) => (pid in levels ? levels[pid] : null),
});

test('an app above LibreShard is reported, one at the same level is not', () => {
  const e = createElevation({ platform: 'win32', api: fakeApi(MEDIUM, { 10: HIGH, 11: MEDIUM, 12: 0x1000 }) });
  assert.equal(e.above({ pid: 10 }), true);
  assert.equal(e.above({ pid: 11 }), false);
  assert.equal(e.above({ pid: 12 }), false, 'a low-integrity app gets our keys');
  assert.equal(e.selfElevated(), false);
});

test('when LibreShard is elevated too, elevated apps are fine', () => {
  const e = createElevation({ platform: 'win32', api: fakeApi(HIGH, { 10: HIGH }) });
  assert.equal(e.above({ pid: 10 }), false);
  assert.equal(e.selfElevated(), true);
});

test('anything unknown is null, never a block', () => {
  const e = createElevation({ platform: 'win32', api: fakeApi(MEDIUM, {}) });
  assert.equal(e.above({ pid: 99 }), null, 'access denied (anti-cheat, system process)');
  assert.equal(e.above({ exe: 'game.exe' }), null, 'no pid (title or xprop providers)');
  assert.equal(e.above(null), null, 'nothing detected');
  assert.equal(e.above({ pid: -1 }), null);
  assert.equal(createElevation({ platform: 'win32', api: fakeApi(null, { 10: HIGH }) }).above({ pid: 10 }), null, 'our own level unknown');
});

test('other systems never load anything and always answer null', () => {
  let loaded = false;
  const e = createElevation({ platform: 'linux', api: () => { loaded = true; return {}; } });
  assert.equal(e.above({ pid: 10 }), null);
  assert.equal(e.selfElevated(), null);
  assert.equal(loaded, false);
});

test('a missing koffi or a failing call is logged once and counts as unknown', () => {
  const lines = [];
  const log = { warn: (event) => lines.push(event) };
  const broken = createElevation({ platform: 'win32', api: () => { throw new Error('Cannot find module koffi'); } });
  broken.setLog(log);
  assert.equal(broken.above({ pid: 10 }), null);
  assert.equal(broken.above({ pid: 10 }), null);
  assert.deepEqual(lines, ['elevation-unavailable']);

  const failing = createElevation({ platform: 'win32', api: () => ({ ownLevel: () => MEDIUM, processLevel: () => { throw new Error('boom'); } }) });
  failing.setLog(log);
  assert.equal(failing.above({ pid: 10 }), null);
  assert.equal(failing.above({ pid: 10 }), null);
  assert.deepEqual(lines, ['elevation-unavailable', 'elevation-failed']);
});

test('the real module reads this process on Windows', { skip: process.platform !== 'win32' && 'Windows only' }, () => {
  const e = createElevation();
  const mine = e.selfElevated();
  assert.ok(mine === true || mine === false, 'reads our own token');
  assert.equal(e.above({ pid: process.pid }), false, 'a process is never above itself');
});
