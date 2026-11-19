// Turns "ctrl+shift+m" into nut.js keys
const { Key } = require('@nut-tree-fork/nut-js');

const ALIAS = {
  ctrl: 'LeftControl', control: 'LeftControl', shift: 'LeftShift', alt: 'LeftAlt',
  lctrl: 'LeftControl', lshift: 'LeftShift', lalt: 'LeftAlt',
  rctrl: 'RightControl', rshift: 'RightShift', ralt: 'RightAlt',
  win: 'LeftSuper', meta: 'LeftSuper', cmd: 'LeftSuper',
  enter: 'Enter', esc: 'Escape', tab: 'Tab', space: 'Space',
  backspace: 'Backspace', delete: 'Delete', insert: 'Insert', home: 'Home', end: 'End',
  pageup: 'PageUp', pagedown: 'PageDown', print: 'Print', printscreen: 'Print', numlock: 'NumLock',
  up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  comma: 'Comma', period: 'Period', minus: 'Minus', equal: 'Equal', grave: 'Grave',
  slash: 'Slash', backslash: 'Backslash', semicolon: 'Semicolon', apostrophe: 'Quote',
  lbracket: 'LeftBracket', rbracket: 'RightBracket',
  // Numpad ("+" cannot appear inside a combo, hence numpadplus)
  numpadplus: 'Add', numpadminus: 'Subtract', numpadmul: 'Multiply', numpaddiv: 'Divide',
  numpaddot: 'Decimal', numpadenter: 'Enter',
  mute: 'AudioMute', volup: 'AudioVolUp', voldown: 'AudioVolDown',
  playpause: 'AudioPlay', next: 'AudioNext', prev: 'AudioPrev',
};

// The keys libnut presses by the character they type on a US keyboard: digits and symbols (letters
// need no modifier on any common layout, and numpad and named keys go by key code)
const CHARS = {
  Num0: '0', Num1: '1', Num2: '2', Num3: '3', Num4: '4', Num5: '5', Num6: '6', Num7: '7', Num8: '8', Num9: '9',
  Minus: '-', Equal: '=', LeftBracket: '[', RightBracket: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Grave: '`',
};
const CHAR_OF = new Map(Object.entries(CHARS).map(([name, ch]) => [Key[name], ch]));
const MODIFIER_KEYS = {
  shift: [Key.LeftShift, Key.RightShift],
  ctrl: [Key.LeftControl, Key.RightControl],
  alt: [Key.LeftAlt, Key.RightAlt],
};

// A combo's keys (from parse) with the modifiers the keyboard layout needs for its digits and
// symbols (modifiersFor(char) → ['shift'…], see layout.js), each inserted right before its key unless
// the combo already holds that modifier. Without modifiersFor, the keys as they are.
function withLayout(keys, modifiersFor) {
  if (!modifiersFor) return keys;
  const out = [];
  for (const k of keys) {
    const ch = CHAR_OF.get(k);
    if (ch !== undefined) {
      for (const m of modifiersFor(ch)) {
        const variants = MODIFIER_KEYS[m];
        if (variants && !variants.some((v) => keys.includes(v) || out.includes(v))) out.push(variants[0]);
      }
    }
    out.push(k);
  }
  return out;
}

function normalize(combo) {
  return String(combo).toLowerCase().replace(/\s+/g, '');
}

function parse(combo) {
  return normalize(combo).split('+').filter(Boolean).map((part) => {
    let name = ALIAS[part];
    if (!name && /^[a-z]$/.test(part)) name = part.toUpperCase();
    if (!name && /^[0-9]$/.test(part)) name = 'Num' + part;
    if (!name && /^numpad[0-9]$/.test(part)) name = 'NumPad' + part.slice(6);
    if (!name && /^f([1-9]|1[0-9]|2[0-4])$/.test(part)) name = part.toUpperCase();
    const key = Key[name];
    if (key === undefined) throw new Error('Unknown key: ' + part);
    return key;
  });
}

// On Linux, F13–F24 often have no keycode in the X keyboard map (many layouts send XF86Tools and
// friends instead). nut-js then triggers an X error, and Xlib aborts the whole process. So those
// keys are checked against the map (xmodmap -pke) first. Without xmodmap they count as missing.
const RISKY = /^f(1[3-9]|2[0-4])$/;
let keymap = { t: 0, keysyms: null };
function linuxKeysyms() {
  if (keymap.keysyms && Date.now() - keymap.t < 60000) return keymap.keysyms; // layouts can change
  let keysyms = new Set();
  try {
    const out = require('child_process').execFileSync('xmodmap', ['-pke'], { encoding: 'utf8', timeout: 2000 });
    keysyms = new Set(out.split(/\s+/));
  } catch { /* no xmodmap or no X display */ }
  keymap = { t: Date.now(), keysyms };
  return keysyms;
}

// The keys of a combo this system can't press safely (empty almost always). `opts` is for tests.
function unavailable(combo, { platform = process.platform, keysyms } = {}) {
  if (platform !== 'linux') return [];
  const risky = normalize(combo).split('+').filter((p) => RISKY.test(p));
  if (!risky.length) return [];
  const map = keysyms || linuxKeysyms();
  return risky.filter((p) => !map.has(p.toUpperCase()));
}

module.exports = { parse, normalize, unavailable, withLayout };
