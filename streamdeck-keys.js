// The keys of a Stream Deck profile as LibreShard combos ("ctrl+shift+a", "numpad3", "volup").
//
// Each entry of a Hotkey is { KeyModifiers, QTKeyCode, VKeyCode } (app 7.6), plus KeyCtrl, KeyShift,
// KeyOption, KeyCmd and NativeCode in older profiles. QTKeyCode (Qt's key code) is the same on every
// system and comes without Shift; VKeyCode depends on the system the shortcut was recorded on
// (Windows virtual-key codes, or macOS key codes). So Qt says which key it is, and the native code
// only refines it: the numeric keypad, which Qt alone doesn't tell apart. Measured with the
// Stream Deck app 7.6 (docs/plans/paneles-sin-programar.md, 8.0):
// - modifiers in KeyModifiers: Shift 1, Ctrl 2, Alt 4, Win/Cmd 8;
// - the numeric keypad: bit 16384 and the Qt code of its character (Num / adds bit 131072);
// - F13–F24, symbols and media keys come with VKeyCode -1 and only their Qt code.

const EMPTY_QT = 33554431; // an unused entry (VKeyCode -1)
const MOD = { shift: 1, ctrl: 2, alt: 4, meta: 8 };
const NUMPAD_BIT = 16384;

const QT_SPECIAL = 0x01000000;
const qtSpecial = {
  0x00: 'esc', 0x01: 'tab', 0x03: 'backspace', 0x04: 'enter', 0x05: 'numpadenter', 0x06: 'insert', 0x07: 'delete',
  0x09: 'print', 0x10: 'home', 0x11: 'end', 0x12: 'left', 0x13: 'up', 0x14: 'right', 0x15: 'down',
  0x16: 'pageup', 0x17: 'pagedown', 0x20: 'shift', 0x21: 'ctrl', 0x22: 'win', 0x23: 'alt', 0x25: 'numlock',
  0x70: 'voldown', 0x71: 'mute', 0x72: 'volup',
  0x80: 'playpause', 0x82: 'prev', 0x83: 'next', 0x85: 'playpause', 0x86: 'playpause',
};
const QT_PLAY = 0x01020005; // Qt::Key_Play
// Keys LibreShard can't press: shown as the reason a button wasn't imported
const QT_UNSUPPORTED = { 0x08: 'pause', 0x0b: 'clear', 0x24: 'capslock', 0x26: 'scrolllock', 0x55: 'menu', 0x63: 'browser-stop', 0x81: 'stop' };

const ASCII = {
  32: 'space', 39: 'apostrophe', 44: 'comma', 45: 'minus', 46: 'period', 47: 'slash', 59: 'semicolon', 61: 'equal',
  91: 'lbracket', 92: 'backslash', 93: 'rbracket', 96: 'grave',
  42: 'numpadmul', 43: 'numpadplus', // unshifted, only the keypad gives these on a US keyboard
};
const NUMPAD_OF = { 42: 'numpadmul', 43: 'numpadplus', 45: 'numpadminus', 46: 'numpaddot', 47: 'numpaddiv' };

function qtName(qt, numpad) {
  if (qt >= 65 && qt <= 90) return String.fromCharCode(qt + 32);
  if (qt >= 48 && qt <= 57) return (numpad ? 'numpad' : '') + String.fromCharCode(qt);
  if (numpad && NUMPAD_OF[qt]) return NUMPAD_OF[qt];
  if (ASCII[qt]) return ASCII[qt];
  if (qt === QT_PLAY) return 'playpause';
  const n = qt - QT_SPECIAL;
  if (n >= 0x30 && n <= 0x47) return 'f' + (n - 0x2f);
  return n >= 0 ? qtSpecial[n] : undefined;
}

// Windows virtual-key codes
const VK = {
  8: 'backspace', 9: 'tab', 13: 'enter', 27: 'esc', 32: 'space', 33: 'pageup', 34: 'pagedown', 35: 'end', 36: 'home',
  37: 'left', 38: 'up', 39: 'right', 40: 'down', 44: 'print', 45: 'insert', 46: 'delete',
  106: 'numpadmul', 107: 'numpadplus', 109: 'numpadminus', 110: 'numpaddot', 111: 'numpaddiv', 144: 'numlock',
  173: 'mute', 174: 'voldown', 175: 'volup', 176: 'next', 177: 'prev', 179: 'playpause',
  186: 'semicolon', 187: 'equal', 188: 'comma', 189: 'minus', 190: 'period', 191: 'slash', 192: 'grave',
  219: 'lbracket', 220: 'backslash', 221: 'rbracket', 222: 'apostrophe',
  16: 'shift', 17: 'ctrl', 18: 'alt', 91: 'win',
};
function vkName(vk) {
  if ((vk >= 65 && vk <= 90) || (vk >= 48 && vk <= 57)) return String.fromCharCode(vk).toLowerCase();
  if (vk >= 96 && vk <= 105) return 'numpad' + (vk - 96);
  if (vk >= 112 && vk <= 135) return 'f' + (vk - 111);
  return VK[vk];
}

// macOS key codes (kVK_*)
const MAC = {
  0: 'a', 1: 's', 2: 'd', 3: 'f', 4: 'h', 5: 'g', 6: 'z', 7: 'x', 8: 'c', 9: 'v', 11: 'b', 12: 'q', 13: 'w', 14: 'e',
  15: 'r', 16: 'y', 17: 't', 18: '1', 19: '2', 20: '3', 21: '4', 22: '6', 23: '5', 24: 'equal', 25: '9', 26: '7',
  27: 'minus', 28: '8', 29: '0', 30: 'rbracket', 31: 'o', 32: 'u', 33: 'lbracket', 34: 'i', 35: 'p', 36: 'enter',
  37: 'l', 38: 'j', 39: 'apostrophe', 40: 'k', 41: 'semicolon', 42: 'backslash', 43: 'comma', 44: 'slash', 45: 'n',
  46: 'm', 47: 'period', 48: 'tab', 49: 'space', 50: 'grave', 51: 'backspace', 53: 'esc',
  65: 'numpaddot', 67: 'numpadmul', 69: 'numpadplus', 75: 'numpaddiv', 76: 'numpadenter', 78: 'numpadminus',
  82: 'numpad0', 83: 'numpad1', 84: 'numpad2', 85: 'numpad3', 86: 'numpad4', 87: 'numpad5', 88: 'numpad6',
  89: 'numpad7', 91: 'numpad8', 92: 'numpad9',
  122: 'f1', 120: 'f2', 99: 'f3', 118: 'f4', 96: 'f5', 97: 'f6', 98: 'f7', 100: 'f8', 101: 'f9', 109: 'f10',
  103: 'f11', 111: 'f12', 105: 'f13', 107: 'f14', 113: 'f15', 106: 'f16', 64: 'f17', 79: 'f18', 80: 'f19', 90: 'f20',
  115: 'home', 116: 'pageup', 117: 'delete', 119: 'end', 121: 'pagedown', 123: 'left', 124: 'right', 125: 'down', 126: 'up',
};

// A keypad key and the main key with the same character look alike to Qt ("numpad3" and "3")
const NUMPAD_BASE = { numpadminus: 'minus', numpaddot: 'period', numpaddiv: 'slash', numpadenter: 'enter' };
const sameKey = (native, qt) => native === qt || native === 'numpad' + qt || NUMPAD_BASE[native] === qt;

const isEmpty = (e) => !e || typeof e !== 'object' ||
  ((e.VKeyCode === -1 || e.VKeyCode === undefined) && (e.QTKeyCode === EMPTY_QT || e.QTKeyCode === undefined) && !e.KeyModifiers);

// One Hotkey entry → { combo, adapted?, review? }, { unsupported: 'pause' } or null when empty.
// `source`: the system it was recorded on ('windows', 'mac' or 'unknown'); `target`: process.platform.
function entryToCombo(e, { source = 'unknown', target = process.platform } = {}) {
  if (isEmpty(e)) return null;
  const mods = Number.isInteger(e.KeyModifiers) ? e.KeyModifiers : 0;
  const qt = Number.isInteger(e.QTKeyCode) ? e.QTKeyCode : -1;
  const vk = Number.isInteger(e.VKeyCode) ? e.VKeyCode : -1;
  const numpadBit = (mods & NUMPAD_BIT) !== 0;

  let name = qt === EMPTY_QT ? undefined : qtName(qt, numpadBit);
  let review = false;
  const native = vk < 0 ? undefined : source === 'windows' ? vkName(vk) : source === 'mac' ? MAC[vk] : undefined;
  if (native) {
    if (!name) name = native;
    else if (sameKey(native, name)) name = native; // the native code knows the keypad
    else review = true; // they disagree: Qt wins
  } else if (!name && source === 'unknown' && vk >= 0) {
    name = vkName(vk); // no Qt code and no idea of the system: Windows is the likelier guess
    review = !!name;
  }
  if (!name) {
    const n = qt - QT_SPECIAL;
    return { unsupported: QT_UNSUPPORTED[n] || 'unknown' };
  }

  // Older profiles say which modifiers in booleans; 7.6 only in the bits
  const has = (flag, bit) => (flag in e ? e[flag] === true : false) || (mods & bit) !== 0;
  const parts = [];
  if (has('KeyCtrl', MOD.ctrl)) parts.push('ctrl');
  if (has('KeyShift', MOD.shift)) parts.push('shift');
  if (has('KeyOption', MOD.alt)) parts.push('alt');
  let adapted;
  if (has('KeyCmd', MOD.meta)) {
    if (source === 'mac' && target !== 'darwin') { if (!parts.includes('ctrl')) parts.unshift('ctrl'); adapted = 'mac'; }
    else parts.push(target === 'darwin' ? 'cmd' : 'win');
  }
  const combo = parts.includes(name) ? parts.join('+') : [...parts, name].join('+');
  return { combo, ...(adapted ? { adapted } : {}), ...(review ? { review: true } : {}) };
}

// The real (non-empty) entries of a Hotkeys list
const realEntries = (list) => (Array.isArray(list) ? list.filter((e) => !isEmpty(e)) : []);

// The system a profile was made on: package.json's OSType (format 3.0), else its AppIdentifier
function sourceSystem({ osType, appIdentifier } = {}) {
  const os = String(osType || '').toLowerCase();
  if (os.startsWith('win')) return 'windows';
  if (os.startsWith('mac') || os === 'osx' || os === 'darwin') return 'mac';
  const app = String(appIdentifier || '');
  if (/^[a-z]:\\/i.test(app) || /\.exe$/i.test(app)) return 'windows';
  if (app.startsWith('/') || /\.app$/i.test(app)) return 'mac';
  return 'unknown';
}

module.exports = { entryToCombo, realEntries, sourceSystem, qtName, vkName, EMPTY_QT };
