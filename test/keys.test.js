const test = require('node:test');
const assert = require('node:assert/strict');
const { Key } = require('@nut-tree-fork/nut-js');
const { parse, normalize } = require('../keys');

test('normalize lowercases and strips whitespace', () => {
  assert.equal(normalize(' Ctrl + Shift + M '), 'ctrl+shift+m');
});

test('parse maps modifiers, letters and digits', () => {
  assert.deepEqual(parse('ctrl+shift+m'), [Key.LeftControl, Key.LeftShift, Key.M]);
  assert.deepEqual(parse('alt+1'), [Key.LeftAlt, Key.Num1]);
});

test('parse keeps left and right modifiers apart', () => {
  assert.deepEqual(parse('rctrl+ralt+rshift'), [Key.RightControl, Key.RightAlt, Key.RightShift]);
  assert.deepEqual(parse('lctrl+lalt+lshift'), [Key.LeftControl, Key.LeftAlt, Key.LeftShift]);
});

test('parse supports function keys up to f24', () => {
  assert.deepEqual(parse('f1'), [Key.F1]);
  assert.deepEqual(parse('f24'), [Key.F24]);
  assert.throws(() => parse('f25'), /Unknown key/);
});

test('parse supports the numpad and media keys', () => {
  assert.deepEqual(parse('numpad7+numpadplus+numpadenter'), [Key.NumPad7, Key.Add, Key.Enter]);
  assert.deepEqual(parse('playpause'), [Key.AudioPlay]);
  assert.deepEqual(parse('volup'), [Key.AudioVolUp]);
});

test('parse supports the print screen key', () => {
  assert.deepEqual(parse('shift+print'), [Key.LeftShift, Key.Print]);
  assert.deepEqual(parse('printscreen'), [Key.Print]);
});

test('parse throws on unknown keys', () => {
  assert.throws(() => parse('ctrl+banana'));
});

test('unavailable only ever flags F13-F24 on Linux, when the keymap lacks them', () => {
  const { unavailable } = require('../keys');
  const keysyms = new Set(['F13', 'XF86Tools', 'Control_L']);
  assert.deepEqual(unavailable('ctrl+f13', { platform: 'linux', keysyms }), []);
  assert.deepEqual(unavailable('ctrl+f14+f24', { platform: 'linux', keysyms }), ['f14', 'f24']);
  assert.deepEqual(unavailable('ctrl+s', { platform: 'linux', keysyms: new Set() }), [], 'ordinary keys are never checked');
  assert.deepEqual(unavailable('f13', { platform: 'win32', keysyms: new Set() }), []);
  assert.deepEqual(unavailable('f13', { platform: 'darwin', keysyms: new Set() }), []);
});
