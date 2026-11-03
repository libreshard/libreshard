// Provider backed by active-win@8 (Windows and macOS; on Linux it shells out to xprop, still to be
// verified). It knows the program behind the window, not just its title.
let aw = null;
try { aw = require('active-win'); } catch { /* optional dependency not installed */ }

// On macOS, don't trigger the Screen Recording prompt just to read the title
const OPTIONS = { screenRecordingPermission: false };

const toApp = (w) => w && w.owner && {
  exe: w.owner.path ? w.owner.path.split(/[\\/]/).pop() : String(w.owner.name || ''),
  name: String(w.owner.name || ''),
  title: String(w.title || ''),
  path: String(w.owner.path || ''),
};

module.exports = {
  name: 'active-win',
  available: () => !!aw,
  active: async () => toApp(await aw(OPTIONS)),
  openWindows: async () => (await aw.getOpenWindows(OPTIONS)).map(toApp).filter(Boolean),
};
