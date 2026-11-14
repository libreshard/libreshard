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

// What navigator.keyboard.getLayoutMap() gives for a few keys (the character typed without modifiers)
const US = new Map(Object.entries({
  KeyA: 'a', KeyQ: 'q', KeyZ: 'z', Semicolon: ';', Quote: "'", Backslash: '\\', Minus: '-', Equal: '=',
  BracketLeft: '[', BracketRight: ']', Backquote: '`', Comma: ',', Period: '.', Slash: '/',
}));
const ES_MX = new Map(Object.entries({
  KeyA: 'a', KeyQ: 'q', KeyZ: 'z', Semicolon: 'ñ', Quote: '{', Backslash: '}', Minus: "'", Equal: '¿',
  BracketLeft: '´', BracketRight: '+', Backquote: '|', Comma: ',', Period: '.', Slash: '-', IntlBackslash: '<',
}));
const AZERTY = new Map(Object.entries({ KeyQ: 'a', KeyA: 'q', KeyW: 'z' }));

test('Windows and Linux: the character the key types on the current layout, as libnut presses it', () => {
  for (const platform of ['win32', 'linux']) {
    const press = (o, layout) => K.fromEvent(ev(o), platform, layout);
    assert.equal(press({ code: 'Semicolon', key: ';' }, US).combo, 'semicolon');
    assert.equal(press({ code: 'Backquote', key: '`' }, US).combo, 'grave');
    // Spanish (Mexico): the key that types ñ has no keys.js name (libnut would press ` instead,
    // the } key there), and the key that types - is "minus" whatever its position
    assert.deepEqual(press({ code: 'Semicolon', key: 'ñ' }, ES_MX), { unknown: 'ñ' });
    assert.deepEqual(press({ code: 'BracketRight', key: '+' }, ES_MX), { unknown: '+' });
    assert.equal(press({ code: 'Slash', key: '-' }, ES_MX).combo, 'minus');
    assert.equal(press({ code: 'Minus', key: "'" }, ES_MX).combo, 'apostrophe');
    assert.equal(press({ code: 'Slash', key: '_', shiftKey: true }, ES_MX).combo, 'shift+minus', 'Shift doesn\'t change the key');
    assert.equal(press({ code: 'KeyZ', key: 'z', ctrlKey: true }, ES_MX).combo, 'ctrl+z');
    assert.equal(press({ code: 'KeyQ', key: 'a' }, AZERTY).combo, 'a', 'AZERTY: the key that types a');
    assert.equal(press({ code: 'Digit1', key: '!', shiftKey: true }, ES_MX).combo, 'shift+1');
  }
});

test('without a layout map: the unshifted character, else the US position; macOS: the physical key', () => {
  const linux = (o) => K.fromEvent(ev(o), 'linux').combo;
  assert.equal(linux({ code: 'KeyQ', key: 'a' }), 'a');
  assert.equal(linux({ code: 'Minus', key: "'" }), 'apostrophe');
  assert.equal(linux({ code: 'Minus', key: '_', shiftKey: true }), 'shift+minus');
  const mac = (o) => K.fromEvent(ev(o), 'darwin', ES_MX).combo;
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
  assert.deepEqual(K.split('shift+ctrl+f5'), { mods: ['ctrl', 'shift'], keys: ['f5'] });
  assert.deepEqual(K.split('alt'), { mods: ['alt'], keys: [] });
  assert.deepEqual(K.split('meta+e'), { mods: ['win'], keys: ['e'] });
  // Several keys keep their order (a Windows Alt code), without repeats
  assert.deepEqual(K.split('alt+numpad1+numpad6+numpad4'), { mods: ['alt'], keys: ['numpad1', 'numpad6', 'numpad4'] });
  assert.equal(K.join(['shift', 'ctrl'], 'f5'), 'ctrl+shift+f5');
  assert.equal(K.join(['alt'], ['numpad1', 'numpad6', 'numpad4']), 'alt+numpad1+numpad6+numpad4');
  assert.equal(K.join(['win', 'ctrl', 'shift'], ['b']), 'ctrl+shift+win+b');
  assert.equal(K.join([], ['a', '', 'a', 'b']), 'a+b');
  assert.equal(K.join(['alt'], ''), 'alt');
  assert.equal(K.join([], []), '');
  assert.equal(K.label('alt+numpad1+numpad6+numpad4', 'win32'), 'Alt+Num 1+Num 6+Num 4');
  assert.doesNotThrow(() => parse('alt+numpad1+numpad6+numpad4'));
});
