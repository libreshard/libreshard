// The panel editor's keys: captured keydowns become names keys.js can press, on every system, and
// every key the picker offers is one keys.js knows.
const test = require('node:test');
const assert = require('node:assert/strict');
const K = require('../desktop/keycodes');
const { parse } = require('../keys');

const ev = (o) => ({ key: '', code: '', keyCode: 0, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...o });

test('every key the picker offers, and every modifier, is a key keys.js can press', () => {
  const names = [...Object.values(K.GROUPS).flat(), ...K.MODIFIERS];
  assert.ok(names.length > 100);
  for (const n of names) assert.doesNotThrow(() => parse(n), n);
  assert.equal(new Set(names).size, names.length, 'no repeats');
});

test('layout-independent keys come from e.code on every system', () => {
  const codes = ['F1', 'F13', 'F24', 'Numpad0', 'Numpad9', 'NumpadAdd', 'NumpadSubtract', 'NumpadMultiply', 'NumpadDivide',
    'NumpadDecimal', 'NumpadEnter', 'NumLock', 'Digit1', 'Enter', 'Escape', 'Tab', 'Space', 'Backspace', 'Delete', 'Insert',
    'Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowLeft', 'PrintScreen', 'AudioVolumeMute', 'AudioVolumeUp',
    'AudioVolumeDown', 'MediaPlayPause', 'MediaTrackNext', 'MediaTrackPrevious'];
  for (const platform of ['win32', 'linux', 'darwin']) {
    for (const code of codes) {
      const r = K.fromEvent(ev({ code, key: 'x', keyCode: 1 }), platform);
      assert.ok(r.combo, `${platform} ${code}`);
      assert.doesNotThrow(() => parse(r.combo), `${platform} ${code} → ${r.combo}`);
    }
  }
  assert.equal(K.fromEvent(ev({ code: 'Numpad3', key: 'PageDown' }), 'win32').combo, 'numpad3', 'the numpad key, whatever NumLock says');
  assert.equal(K.fromEvent(ev({ code: 'F13' }), 'linux').combo, 'f13');
});

test('Windows: letters and punctuation follow the virtual-key code, as nut-js presses them', () => {
  const win = (o) => K.fromEvent(ev(o), 'win32').combo;
  assert.equal(win({ code: 'KeyA', key: 'a', keyCode: 65 }), 'a');
  assert.equal(win({ code: 'KeyQ', key: 'a', keyCode: 65 }), 'a', 'AZERTY: the key labelled A');
  assert.equal(win({ code: 'KeyC', key: 'c', keyCode: 67, ctrlKey: true, shiftKey: true }), 'ctrl+shift+c');
  // Spanish layout: the key right of 0 types ' and Windows gives it VK_OEM_4
  assert.equal(win({ code: 'Minus', key: "'", keyCode: 219 }), 'lbracket');
  assert.equal(win({ code: 'Slash', key: '-', keyCode: 189 }), 'minus');
  assert.equal(win({ code: 'Semicolon', key: 'ñ', keyCode: 192 }), 'grave');
  assert.deepEqual(K.fromEvent(ev({ code: 'IntlBackslash', key: '<', keyCode: 226 }), 'win32'), { unknown: '<' });
});

test('Linux: the character the key types; macOS: the physical key', () => {
  const linux = (o) => K.fromEvent(ev(o), 'linux').combo;
  assert.equal(linux({ code: 'KeyQ', key: 'a' }), 'a');
  assert.equal(linux({ code: 'Minus', key: "'" }), 'apostrophe');
  assert.equal(linux({ code: 'Slash', key: '-' }), 'minus');
  assert.equal(linux({ code: 'Digit1', key: '!', shiftKey: true }), 'shift+1');
  assert.equal(linux({ code: 'Minus', key: '_', shiftKey: true }), 'shift+minus', 'a shifted symbol falls back to the position');
  const mac = (o) => K.fromEvent(ev(o), 'darwin').combo;
  assert.equal(mac({ code: 'KeyQ', key: 'a', metaKey: true }), 'win+q');
  assert.equal(mac({ code: 'Minus', key: "'" }), 'minus');
});

test('a modifier alone is reported as a modifier, with every modifier held', () => {
  assert.deepEqual(K.fromEvent(ev({ code: 'ShiftLeft', key: 'Shift', shiftKey: true }), 'win32'), { modifier: 'shift', mods: ['shift'] });
  assert.deepEqual(K.fromEvent(ev({ code: 'AltRight', key: 'AltGraph', ctrlKey: true, altKey: true }), 'win32'), { modifier: 'alt', mods: ['ctrl', 'alt'] });
  assert.deepEqual(K.fromEvent(ev({ code: 'MetaLeft', key: 'Meta', metaKey: true }), 'linux'), { modifier: 'win', mods: ['win'] });
});

test('labels, and splitting and joining combos', () => {
  assert.equal(K.label('ctrl+shift+f13', 'win32'), 'Ctrl+Shift+F13');
  assert.equal(K.label('win+d', 'win32'), 'Win+D');
  assert.equal(K.label('win+d', 'linux'), 'Super+D');
  assert.equal(K.label('cmd+c', 'darwin'), 'Cmd+C');
  assert.equal(K.label('numpad3', 'win32'), 'Num 3');
  assert.deepEqual(K.split('shift+ctrl+f5'), { mods: ['ctrl', 'shift'], key: 'f5' });
  assert.deepEqual(K.split('alt'), { mods: ['alt'], key: '' });
  assert.deepEqual(K.split('meta+e'), { mods: ['win'], key: 'e' });
  assert.equal(K.join(['shift', 'ctrl'], 'f5'), 'ctrl+shift+f5');
  assert.equal(K.join(['alt'], ''), 'alt');
  assert.equal(K.join([], ''), '');
});
