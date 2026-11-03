// Key maps per program. Checked in the real apps: GIMP 3.2 and Krita 5 (2026-11). Photoshop and
// Affinity Photo use their documented defaults and are still to be checked in the apps.
// null: the program has no default shortcut for that action (the button is shown disabled).
const MAPS = {
  photoshop: {
    name: 'Photoshop', brush: 'b', eraser: 'e', move: 'v', lasso: 'l', picker: 'i',
    sizedown: 'lbracket', sizeup: 'rbracket', zoomout: 'ctrl+minus', zoomin: 'ctrl+equal',
    undo: 'ctrl+z', redo: 'ctrl+shift+z', save: 'ctrl+s', pan: 'space', sample: 'alt',
  },
  affinity: {
    name: 'Affinity Photo', brush: 'b', eraser: 'e', move: 'v', lasso: 'l', picker: 'i',
    sizedown: 'lbracket', sizeup: 'rbracket', zoomout: 'ctrl+minus', zoomin: 'ctrl+equal',
    undo: 'ctrl+z', redo: 'ctrl+shift+z', save: 'ctrl+s', pan: 'space', sample: 'alt',
  },
  // Krita: E toggles the brush's eraser mode; the freehand selection tool has no shortcut
  krita: {
    name: 'Krita', brush: 'b', eraser: 'e', eraserToggle: true, move: 't', lasso: null, picker: 'p',
    sizedown: 'lbracket', sizeup: 'rbracket', zoomout: 'numpadminus', zoomin: 'numpadplus',
    undo: 'ctrl+z', redo: 'ctrl+shift+z', save: 'ctrl+s', pan: 'space', sample: 'ctrl',
  },
  // GIMP: Ctrl+Shift+Z does not redo, and Ctrl+= does not zoom in
  gimp: {
    name: 'GIMP', brush: 'p', eraser: 'shift+e', move: 'm', lasso: 'f', picker: 'o',
    sizedown: 'lbracket', sizeup: 'rbracket', zoomout: 'numpadminus', zoomin: 'numpadplus',
    undo: 'ctrl+z', redo: 'ctrl+y', save: 'ctrl+s', pan: 'space', sample: 'ctrl',
  },
};

function apply(settings) {
  const map = MAPS[settings.program] || MAPS.photoshop;
  document.getElementById('program').textContent = map.name;
  document.getElementById('helpProgram').textContent = Shard.t('helpProgram', { name: map.name });
  for (const el of document.querySelectorAll('[data-act]')) {
    const combo = map[el.dataset.act];
    const attr = el.dataset.as === 'hold' ? 'hold' : 'key';
    LS.setKey(el, combo, attr);
    // An action the program has no shortcut for stays visible, greyed out, so the layout doesn't jump
    el.hidden = false;
    el.classList.toggle('is-off', !combo);
    if (!combo) el.querySelector('.ls-key').textContent = Shard.t('noKey');
  }
  document.querySelector('.eraser-label').textContent = Shard.t(map.eraserToggle ? 'eraserMode' : 'eraser');
}

LS.ready(() => LS.settings(apply));
