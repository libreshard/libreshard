// Key maps per program, checked in the apps (2026-11): Meet and Teams in a real meeting, Zoom 7.1
// in its Settings → Keyboard shortcuts (not in a meeting). None of them is global by default: the
// meeting window has to be in front. null: no default shortcut (the button is shown disabled).
const MAPS = {
  zoom: { name: 'Zoom', mic: 'alt+a', camera: 'alt+v', hand: 'alt+y', share: 'alt+s', leave: 'alt+q' },
  teams: { name: 'Microsoft Teams', mic: 'ctrl+shift+m', camera: 'ctrl+shift+o', hand: 'ctrl+shift+k', share: 'ctrl+shift+e', leave: 'ctrl+shift+h' },
  meet: { name: 'Google Meet', mic: 'ctrl+d', camera: 'ctrl+e', hand: 'ctrl+alt+h', share: 'ctrl+alt+t', leave: null },
};

let map = MAPS.zoom;

function apply(settings) {
  map = MAPS[settings.program] || MAPS.zoom;
  document.getElementById('program').textContent = map.name;
  document.getElementById('helpProgram').textContent = Shard.t('helpProgram', { name: map.name });
  for (const el of document.querySelectorAll('[data-act]')) LS.setKey(el, map[el.dataset.act]);
  // "Leave" keeps its combo off the button (it needs a second tap); it's only shown as a label
  const leave = document.getElementById('leave');
  leave.classList.toggle('is-off', !map.leave);
  leave.querySelector('.ls-key').textContent = map.leave ? LS.keyLabel(map.leave) : Shard.t('noKey');
}

LS.ready(() => {
  LS.settings(apply);
  LS.confirmTap(document.getElementById('leave'), () => { if (map.leave) Shard.press(map.leave); });
});
