// Discord's global keybinds are set up by the user (Settings → Keybinds) with combos no app uses.
// Checked with Discord 1.0.9266 on Windows 11 (2026-11): it records the injected combos (F13+
// included) and reacts to them with another app in front, but not while its settings are open.
// On Linux, F13–F24 are missing from most keyboard maps, hence a second set; its combos were
// checked to reach apps under GNOME 46 and XFCE 4.18 without being taken by the desktop.
const ACTIONS = ['talk', 'mute', 'deafen', 'camera', 'disconnect'];
const SETS = {
  windows: { name: 'Windows', talk: 'ctrl+shift+f15', mute: 'ctrl+shift+f13', deafen: 'ctrl+shift+f14', camera: 'ctrl+shift+f16', disconnect: 'ctrl+shift+f17' },
  linux: { name: 'Linux', talk: 'ctrl+shift+f3', mute: 'ctrl+shift+f1', deafen: 'ctrl+shift+f2', camera: 'ctrl+shift+f4', disconnect: 'ctrl+shift+f6' },
};
// Discord's own name for each action, as shown in its Keybinds list
const DISCORD_NAME = { talk: 'aTalk', mute: 'aMute', deafen: 'aDeafen', camera: 'aCamera', disconnect: 'aDisconnect' };

let set = SETS.windows;

function pick(keys) {
  if (SETS[keys]) return SETS[keys];
  return Shard.platform === 'linux' ? SETS.linux : SETS.windows; // "auto"
}

// The setup sheet: one row per action with a button that sends its combo while Discord records it
function renderBinds() {
  const list = document.getElementById('binds');
  list.textContent = '';
  for (const act of ACTIONS) {
    const row = document.createElement('div');
    row.className = 'bind';
    const name = document.createElement('span');
    name.className = 'bind-name';
    name.textContent = Shard.t(DISCORD_NAME[act]);
    const combo = document.createElement('kbd');
    combo.textContent = LS.keyLabel(set[act]);
    const send = document.createElement('button');
    send.className = 'ls-btn ls-btn--accent bind-send';
    send.dataset.key = set[act];
    send.textContent = Shard.t('send');
    row.append(name, combo, send);
    list.append(row);
  }
}

function apply(settings) {
  set = pick(settings.keys);
  document.getElementById('keyset').textContent = set.name;
  document.getElementById('keysFor').textContent = Shard.t('keysFor', { name: set.name });
  for (const el of document.querySelectorAll('[data-act]')) {
    LS.setKey(el, set[el.dataset.act], el.dataset.as === 'hold' ? 'hold' : 'key');
  }
  document.querySelector('#disconnect .ls-key').textContent = LS.keyLabel(set.disconnect);
  document.querySelector('.a-talk .ls-key').textContent = Shard.t('talkHint');
  renderBinds();
}

LS.ready(() => {
  LS.settings(apply);
  LS.confirmTap(document.getElementById('disconnect'), () => Shard.press(set.disconnect));
});
