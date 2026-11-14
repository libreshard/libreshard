// Keys for the panel editor: turning a captured keydown into a keys.js name, the list of keys to
// pick from, and readable labels. Used by desktop/editor.js (as window.Keycodes) and by the tests.
//
// What a captured key must become depends on how nut-js presses it on that system:
// - Windows and Linux: by character. For a letter or a symbol, libnut asks the system which key
//   types that character on the layout in use when it presses (VkKeyScan on Windows, the keysym on
//   X11). So the name must be the character the captured key types, without Shift, on the current
//   layout: the keyboard layout map gives it whatever modifiers are held. Checked 2026-11-14 on
//   Windows: with Spanish (Mexico), "grave" is pressed as the key that types ` there, the } key.
//   Characters keys.js has no name for (ñ, ´, + on a Spanish layout) can't be captured.
// - macOS: by physical key code, so e.code.
// Function keys, the numpad, navigation and media keys are the same everywhere (e.code).
(() => {
  const MODIFIERS = ['ctrl', 'shift', 'alt', 'win'];
  const MODIFIER_CODES = {
    ControlLeft: 'ctrl', ControlRight: 'ctrl', ShiftLeft: 'shift', ShiftRight: 'shift',
    AltLeft: 'alt', AltRight: 'alt', MetaLeft: 'win', MetaRight: 'win', OSLeft: 'win', OSRight: 'win',
  };

  // e.code → name, for keys that don't depend on the layout
  const CODES = {
    Enter: 'enter', Escape: 'esc', Tab: 'tab', Space: 'space', Backspace: 'backspace', Delete: 'delete',
    Insert: 'insert', Home: 'home', End: 'end', PageUp: 'pageup', PageDown: 'pagedown',
    ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right',
    PrintScreen: 'print', NumLock: 'numlock',
    NumpadAdd: 'numpadplus', NumpadSubtract: 'numpadminus', NumpadMultiply: 'numpadmul',
    NumpadDivide: 'numpaddiv', NumpadDecimal: 'numpaddot', NumpadEnter: 'numpadenter',
    AudioVolumeMute: 'mute', AudioVolumeUp: 'volup', AudioVolumeDown: 'voldown',
    VolumeMute: 'mute', VolumeUp: 'volup', VolumeDown: 'voldown',
    MediaPlayPause: 'playpause', MediaTrackNext: 'next', MediaTrackPrevious: 'prev',
  };
  for (let i = 0; i <= 9; i++) { CODES['Digit' + i] = String(i); CODES['Numpad' + i] = 'numpad' + i; }
  for (let i = 1; i <= 24; i++) CODES['F' + i] = 'f' + i;

  // Punctuation by position (macOS, and without a layout map elsewhere)
  const PUNCT_CODES = {
    Minus: 'minus', Equal: 'equal', Comma: 'comma', Period: 'period', Slash: 'slash', Backslash: 'backslash',
    Semicolon: 'semicolon', Quote: 'apostrophe', Backquote: 'grave', BracketLeft: 'lbracket', BracketRight: 'rbracket',
  };
  // The character a key types (Windows, Linux) → name
  const PUNCT_CHARS = {
    '-': 'minus', '=': 'equal', ',': 'comma', '.': 'period', '/': 'slash', '\\': 'backslash',
    ';': 'semicolon', "'": 'apostrophe', '`': 'grave', '[': 'lbracket', ']': 'rbracket',
  };

  // The main (non-modifier) key of a keydown, as a keys.js name, or null if keys.js has none.
  // `layout` is the keyboard layout map (navigator.keyboard.getLayoutMap(): e.code → the character
  // that key types without modifiers).
  function mainKey(e, platform, layout) {
    if (CODES[e.code]) return CODES[e.code];
    const byPosition = () => (/^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : PUNCT_CODES[e.code] || null);
    if (platform === 'darwin') return byPosition();
    const plain = String(e.key || '');
    const ch = (layout && layout.get(e.code)) || (plain.length === 1 && !e.shiftKey ? plain : '');
    if (!ch) return layout ? null : byPosition();
    const c = ch.toLowerCase();
    if (/^[a-z]$/.test(c)) return c;
    if (/^[0-9]$/.test(c)) return c;
    return PUNCT_CHARS[c] || null;
  }

  // A keydown → { combo } (modifiers in a fixed order, then the key), { modifier } while only a
  // modifier is down, or { unknown } for a key keys.js can't press
  function fromEvent(e, platform, layout) {
    const mods = [e.ctrlKey && 'ctrl', e.shiftKey && 'shift', e.altKey && 'alt', e.metaKey && 'win'].filter(Boolean);
    if (MODIFIER_CODES[e.code] || ['Control', 'Shift', 'Alt', 'Meta', 'OS', 'AltGraph'].includes(e.key)) {
      return { modifier: MODIFIER_CODES[e.code] || null, mods };
    }
    const key = mainKey(e, platform, layout);
    if (!key) return { unknown: (layout && layout.get(e.code)) || e.key || e.code || '?' };
    return { combo: [...mods, key].join('+') };
  }

  // Every key the picker offers, in groups (labels come from the editor's strings: keys.group.*)
  const GROUPS = {
    letters: 'abcdefghijklmnopqrstuvwxyz'.split(''),
    digits: '0123456789'.split(''),
    function: Array.from({ length: 24 }, (_, i) => 'f' + (i + 1)),
    navigation: ['up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown'],
    editing: ['enter', 'esc', 'tab', 'space', 'backspace', 'delete', 'insert', 'print', 'numlock'],
    punctuation: ['minus', 'equal', 'comma', 'period', 'slash', 'backslash', 'semicolon', 'apostrophe', 'grave', 'lbracket', 'rbracket'],
    numpad: [...Array.from({ length: 10 }, (_, i) => 'numpad' + i), 'numpadplus', 'numpadminus', 'numpadmul', 'numpaddiv', 'numpaddot', 'numpadenter'],
    media: ['playpause', 'next', 'prev', 'mute', 'volup', 'voldown'],
  };

  const NAMES = {
    ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt', enter: 'Enter', esc: 'Esc', tab: 'Tab', space: 'Space',
    backspace: '⌫', delete: 'Del', insert: 'Ins', home: 'Home', end: 'End', pageup: 'PgUp', pagedown: 'PgDn',
    up: '↑', down: '↓', left: '←', right: '→', comma: ',', period: '.', minus: '-', equal: '=',
    grave: '`', slash: '/', backslash: '\\', semicolon: ';', apostrophe: "'", lbracket: '[', rbracket: ']',
    numpadplus: 'Num +', numpadminus: 'Num -', numpadmul: 'Num *', numpaddiv: 'Num /', numpaddot: 'Num .',
    numpadenter: 'Num Enter', print: 'Print', numlock: 'Num Lock', mute: 'Mute', volup: 'Vol+', voldown: 'Vol-',
    playpause: 'Play', next: 'Next', prev: 'Prev',
  };

  // "ctrl+shift+f13" → "Ctrl+Shift+F13"; the Windows key is "Win", "Cmd" or "Super" by system
  function label(combo, platform) {
    return String(combo || '').split('+').filter(Boolean).map((k) => {
      if (k === 'win' || k === 'meta' || k === 'cmd') return platform === 'win32' ? 'Win' : platform === 'darwin' ? 'Cmd' : 'Super';
      if (NAMES[k]) return NAMES[k];
      if (/^numpad\d$/.test(k)) return 'Num ' + k.slice(6);
      return k.toUpperCase();
    }).join('+');
  }

  // "ctrl+shift+f13" → { mods: ['ctrl', 'shift'], key: 'f13' }; a combo of modifiers only has key ''
  function split(combo) {
    const parts = String(combo || '').split('+').filter(Boolean);
    const mods = MODIFIERS.filter((m) => parts.includes(m) || (m === 'win' && (parts.includes('meta') || parts.includes('cmd'))));
    const key = parts.filter((p) => !MODIFIERS.includes(p) && !['meta', 'cmd', 'control'].includes(p)).pop() || '';
    return { mods, key };
  }
  const join = (mods, key) => [...MODIFIERS.filter((m) => mods.includes(m)), key].filter(Boolean).join('+');

  const api = { fromEvent, mainKey, label, split, join, GROUPS, MODIFIERS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.Keycodes = api;
})();
