// Fallback provider: only the foreground window's title, through nut-js. Works without extra
// dependencies but can't tell programs apart (a browser tab titled "Photoshop" looks like Photoshop).
module.exports = {
  name: 'title',
  available: () => true,
  active: async () => {
    // Loaded lazily so the module can be required without the native library (tests)
    const { getActiveWindow } = require('@nut-tree-fork/nut-js');
    const win = await getActiveWindow();
    return { exe: '', name: '', title: String((await win.getTitle()) || ''), path: '' };
  },
  openWindows: null,
};
