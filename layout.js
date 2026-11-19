// What the keyboard layout needs to type a character. On Windows, libnut presses digits and symbols
// by the character they type on a US keyboard: it asks Windows which key types that character on the
// active layout (VkKeyScan) but drops the Shift or AltGr that comes with the answer. So on a Latin
// American layout "[" typed "{" (Krita ignored it) and Ctrl+= became Ctrl+0 (checked on 2026-11-18
// with a keyboard hook and Krita). This asks the same question, from the same thread libnut asks it
// from, so the answer matches the key libnut presses, and says which modifiers go with it; the
// server presses them around the key (keys.withLayout).
//
// Windows only, through koffi (an optional dependency, loaded lazily). Anywhere else, or if anything
// fails, it answers nothing and keys are pressed as before.
const { nullLog, once } = require('./log');

const SHIFT = 1;
const CTRL = 2;
const ALT = 4; // Ctrl + Alt is AltGr

function windowsApi() {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const VkKeyScanW = user32.func('int16_t __stdcall VkKeyScanW(uint16_t ch)');
  return { scan: (ch) => VkKeyScanW(ch.charCodeAt(0)) };
}

// platform and api are injectable for the tests; api is only built (koffi loaded) on first use
function createLayout({ platform = process.platform, api = windowsApi } = {}) {
  let native; // undefined: not loaded yet; null: unavailable
  let warnOnce = once(nullLog);

  function load() {
    if (native === undefined) {
      try {
        native = platform === 'win32' ? api() : null;
      } catch (e) {
        native = null;
        warnOnce('layout-unavailable', { error: e });
      }
    }
    return native;
  }

  // The modifiers ('ctrl', 'alt', 'shift') the active layout needs to type one character, or [] when
  // it needs none, has no key for it, or can't be asked
  function modifiersFor(ch) {
    if (typeof ch !== 'string' || ch.length !== 1 || !load()) return [];
    let r;
    try { r = native.scan(ch); } catch (e) { warnOnce('layout-failed', { error: e }); return []; }
    if (!Number.isInteger(r) || r === -1 || (r & 0xff) === 0xff) return [];
    const state = (r >> 8) & 0xff;
    const out = [];
    if (state & CTRL) out.push('ctrl');
    if (state & ALT) out.push('alt');
    if (state & SHIFT) out.push('shift');
    return out;
  }

  const setLog = (log) => { warnOnce = once(log); };

  return { modifiersFor, setLog };
}

module.exports = { createLayout, ...createLayout() };
