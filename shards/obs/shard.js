// OBS Studio has no default hotkeys: the user assigns these combos in Settings → Hotkeys.
// Checked with OBS 32.2 on Windows 11 (2026-11): it records the injected combos (F13+ included)
// and reacts with another app in front ("Never disable hotkeys", the default). The same combo on
// Start/Stop Recording, or on Mute/Unmute, works as one on/off switch.
// The Linux set avoids F13–F24 (missing from most keyboard maps) and the Shift+Alt+F keys that
// GNOME takes for itself (F2, F4, F6, F7, F8, F10); checked under GNOME 46 and XFCE 4.18.
const ACTIONS = ['record', 'stream', 'replay', 'mic', 'desktop'];
const SETS = {
  windows: {
    name: 'Windows', record: 'ctrl+shift+f18', stream: 'ctrl+shift+f19', replay: 'ctrl+shift+f20', mic: 'ctrl+shift+f21', desktop: 'ctrl+shift+f22',
    scenes: ['shift+alt+f13', 'shift+alt+f14', 'shift+alt+f15', 'shift+alt+f16', 'shift+alt+f17', 'shift+alt+f18'],
  },
  linux: {
    name: 'Linux', record: 'ctrl+shift+f7', stream: 'ctrl+shift+f8', replay: 'ctrl+shift+f9', mic: 'ctrl+shift+f10', desktop: 'ctrl+shift+f11',
    scenes: ['shift+alt+f1', 'shift+alt+f3', 'shift+alt+f5', 'shift+alt+f9', 'shift+alt+f11', 'shift+alt+f12'],
  },
};
// OBS's own name for each hotkey, as shown in Settings → Hotkeys
const OBS_NAME = { record: 'oRecord', stream: 'oStream', replay: 'oReplay', mic: 'oMic', desktop: 'oDesktop' };

let set = SETS.windows;

function pick(keys) {
  if (SETS[keys]) return SETS[keys];
  return Shard.platform === 'linux' ? SETS.linux : SETS.windows; // "auto"
}

function button(className, combo, label) {
  const b = document.createElement('button');
  b.className = 'ls-btn ' + className;
  b.dataset.key = combo;
  const text = document.createElement('span');
  text.textContent = label;
  const key = document.createElement('span');
  key.className = 'ls-key';
  key.textContent = LS.keyLabel(combo);
  b.append(text, key);
  return b;
}

// The setup sheet: one row per hotkey with a button that sends its combo while OBS records it
function bindRow(name, combo) {
  const row = document.createElement('div');
  row.className = 'bind';
  const label = document.createElement('span');
  label.textContent = name;
  const kbd = document.createElement('kbd');
  kbd.textContent = LS.keyLabel(combo);
  const send = document.createElement('button');
  send.className = 'ls-btn ls-btn--accent bind-send';
  send.dataset.key = combo;
  send.textContent = Shard.t('send');
  row.append(label, kbd, send);
  return row;
}

function apply(settings) {
  set = pick(settings.keys);
  const count = Math.max(0, Math.min(6, Number(settings.scenes ?? 4)));
  document.getElementById('keyset').textContent = set.name;
  document.getElementById('keysFor').textContent = Shard.t('keysFor', { name: set.name });
  for (const el of document.querySelectorAll('[data-act]')) LS.setKey(el, set[el.dataset.act]);

  const scenes = document.getElementById('scenes');
  scenes.textContent = '';
  for (let i = 0; i < count; i++) {
    const name = String(settings['scene' + (i + 1)] || '').trim() || Shard.t('scene', { n: i + 1 });
    scenes.append(button('scene', set.scenes[i], name));
  }
  document.body.classList.toggle('no-scenes', count === 0);
  document.body.dataset.scenes = count;

  const binds = document.getElementById('binds');
  binds.textContent = '';
  for (const act of ACTIONS) binds.append(bindRow(Shard.t(OBS_NAME[act]), set[act]));
  for (let i = 0; i < count; i++) binds.append(bindRow(Shard.t('oScene', { n: i + 1 }), set.scenes[i]));
}

LS.ready(() => LS.settings(apply));
