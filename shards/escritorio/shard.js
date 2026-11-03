// Key maps per system, checked on Windows 11, Ubuntu 24.04 (GNOME 46, Xorg) and XFCE 4.18 (2026-11).
// null: no default shortcut (the button is shown disabled).
const EDIT = { copy: 'ctrl+c', cut: 'ctrl+x', paste: 'ctrl+v', undo: 'ctrl+z' };
const MAPS = {
  // Windows doesn't accept an injected Win+L (the lock is handled by the logon process)
  windows: {
    name: 'Windows', ...EDIT, shot: 'win+shift+s', desk: 'win+d', task: 'win+tab',
    left: 'ctrl+win+left', right: 'ctrl+win+right', lock: null, lockNote: 'noLockWindows',
  },
  // GNOME: Print opens the screenshot tool, Super alone the overview; no "show desktop" shortcut
  gnome: {
    name: 'Linux · GNOME', ...EDIT, shot: 'print', desk: null, task: 'win',
    left: 'win+pageup', right: 'win+pagedown', lock: 'win+l',
  },
  // XFCE: Shift+Print captures a region; there is no overview of all windows
  xfce: {
    name: 'Linux · XFCE', ...EDIT, shot: 'shift+print', desk: 'ctrl+alt+d', task: null,
    left: 'ctrl+alt+left', right: 'ctrl+alt+right', lock: 'ctrl+alt+l',
  },
};

function pick(system) {
  if (MAPS[system]) return MAPS[system];
  return Shard.platform === 'linux' ? MAPS.gnome : MAPS.windows; // "auto"
}

function apply(settings) {
  const map = pick(settings.system);
  document.getElementById('system').textContent = map.name;
  document.getElementById('helpSystem').textContent = Shard.t('helpSystem', { name: map.name });
  for (const el of document.querySelectorAll('[data-act]')) {
    const combo = map[el.dataset.act];
    LS.setKey(el, combo);
    el.hidden = false;
    el.classList.toggle('is-off', !combo);
    if (!combo) el.querySelector('.ls-key').textContent = Shard.t(el.dataset.act === 'lock' && map.lockNote ? map.lockNote : 'noKey');
  }
}

LS.ready(() => LS.settings(apply));
