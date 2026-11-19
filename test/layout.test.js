const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { Key } = require('@nut-tree-fork/nut-js');
const { createLayout } = require('../layout');
const { parse, withLayout } = require('../keys');
const { makeShardDir, start, authed, closeClients, waitFor } = require('./helpers');

// VkKeyScan's answers on the Latin American layout (0000080A), read on 2026-11-18: the key in the
// low byte, the modifiers in the high one (1 Shift, 2 Ctrl, 4 Alt)
const LATAM = { '[': 0x1de, ']': 0x1bf, '=': 0x130, '-': 0xbd, '1': 0x31, '\\': 0x6db };
const latamApi = () => ({ scan: (ch) => (ch in LATAM ? LATAM[ch] : -1) });

test('the layout says which modifiers a character needs, and nothing when it can\'t tell', () => {
  const l = createLayout({ platform: 'win32', api: latamApi });
  assert.deepEqual(l.modifiersFor('['), ['shift']);
  assert.deepEqual(l.modifiersFor('='), ['shift']);
  assert.deepEqual(l.modifiersFor('-'), []);
  assert.deepEqual(l.modifiersFor('\\'), ['ctrl', 'alt'], 'AltGr is Ctrl + Alt');
  assert.deepEqual(l.modifiersFor('€'), [], 'a character the layout has no key for');
  assert.deepEqual(l.modifiersFor('ab'), []);
  assert.deepEqual(l.modifiersFor(undefined), []);
  assert.deepEqual(createLayout({ platform: 'linux', api: latamApi }).modifiersFor('['), [], 'Windows only');
});

test('without koffi, or when a call fails, keys are pressed as before and the log gets one line', () => {
  const lines = [];
  const log = { warn: (event) => lines.push(event), info() {}, error() {} };
  const missing = createLayout({ platform: 'win32', api: () => { throw new Error('no koffi'); } });
  missing.setLog(log);
  assert.deepEqual(missing.modifiersFor('['), []);
  assert.deepEqual(missing.modifiersFor(']'), []);
  const failing = createLayout({ platform: 'win32', api: () => ({ scan: () => { throw new Error('boom'); } }) });
  failing.setLog(log);
  assert.deepEqual(failing.modifiersFor('['), []);
  assert.deepEqual(failing.modifiersFor('='), []);
  assert.deepEqual(lines, ['layout-unavailable', 'layout-failed']);
});

test('withLayout adds the layout\'s modifiers right before each digit or symbol, unless the combo has them', () => {
  const latam = createLayout({ platform: 'win32', api: latamApi }).modifiersFor;
  assert.deepEqual(withLayout(parse('lbracket'), latam), [Key.LeftShift, Key.LeftBracket]);
  assert.deepEqual(withLayout(parse('ctrl+equal'), latam), [Key.LeftControl, Key.LeftShift, Key.Equal]);
  assert.deepEqual(withLayout(parse('ctrl+minus'), latam), parse('ctrl+minus'), 'no modifier needed');
  assert.deepEqual(withLayout(parse('shift+lbracket'), latam), parse('shift+lbracket'), 'the combo already holds Shift');
  assert.deepEqual(withLayout(parse('rshift+equal'), latam), parse('rshift+equal'), 'either Shift counts');
  assert.deepEqual(withLayout(parse('ctrl+backslash'), latam), [Key.LeftControl, Key.LeftAlt, Key.Backslash], 'AltGr adds only what is missing');
  assert.deepEqual(withLayout(parse('a'), latam), parse('a'), 'letters are left alone');
  assert.deepEqual(withLayout(parse('numpadplus'), latam), parse('numpadplus'), 'numpad keys go by key code');
  assert.deepEqual(withLayout(parse('lbracket'), null), parse('lbracket'), 'no layout: as before');
  assert.deepEqual(withLayout(parse('lbracket'), () => []), parse('lbracket'), 'US: nothing to add');
});

// The server with a fake keyboard and a layout whose answers the test can change
const shardDir = makeShardDir({
  sym: { manifest: { id: 'sym', name: 'Symbols', permissions: { keys: ['lbracket', 'ctrl+equal', 'f13'] } } },
});
test.after(() => fs.rmSync(shardDir, { recursive: true, force: true }));

async function withServer(fn) {
  let layout = { '[': ['shift'], '=': ['shift'] };
  const s = await start({ shardDirs: [shardDir], layoutModifiers: (ch) => layout[ch] || [] });
  s.setLayout = (l) => { layout = l; };
  try { await fn(s); } finally {
    closeClients();
    s.pairing.stop();
    await new Promise((r) => s.server.close(r));
  }
}
const press = (k) => ({ t: 'press', k });
const release = (k) => ({ t: 'release', k });

test('the server presses a symbol with the modifiers the layout needs, and releases them in reverse', () => withServer(async (s) => {
  const c = await authed(s);
  c.send({ type: 'press', shard: 'sym', keys: 'ctrl+equal' });
  await waitFor(() => s.keyboard.events.length === 6);
  assert.deepEqual(s.keyboard.events, [
    press(Key.LeftControl), press(Key.LeftShift), press(Key.Equal),
    release(Key.Equal), release(Key.LeftShift), release(Key.LeftControl),
  ]);
}));

test('a held symbol is released with exactly the keys it was pressed with, even if the layout changed', () => withServer(async (s) => {
  const c = await authed(s);
  c.send({ type: 'down', shard: 'sym', keys: 'lbracket' });
  await waitFor(() => s.keyboard.events.length === 2);
  s.setLayout({}); // switched to US while held
  c.send({ type: 'up', shard: 'sym', keys: 'lbracket' });
  await waitFor(() => s.keyboard.events.length === 4);
  assert.deepEqual(s.keyboard.events, [press(Key.LeftShift), press(Key.LeftBracket), release(Key.LeftBracket), release(Key.LeftShift)]);

  // And when the connection drops while it's held
  s.setLayout({ '[': ['shift'] });
  c.send({ type: 'down', shard: 'sym', keys: 'lbracket' });
  await waitFor(() => s.keyboard.events.length === 6);
  c.ws.terminate();
  await waitFor(() => s.keyboard.events.length === 8);
  assert.deepEqual(s.keyboard.events.slice(6), [release(Key.LeftBracket), release(Key.LeftShift)]);
}));

test('keys that need nothing are pressed exactly as before', () => withServer(async (s) => {
  const c = await authed(s);
  c.send({ type: 'press', shard: 'sym', keys: 'f13' });
  await waitFor(() => s.keyboard.events.length === 2);
  assert.deepEqual(s.keyboard.events, [press(Key.F13), release(Key.F13)]);
}));

test('the real layout is only used with the real keyboard (tests with a fake keyboard get none)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /layoutModifiers = keyboard \? null : require\('\.\/layout'\)\.modifiersFor/);
});
