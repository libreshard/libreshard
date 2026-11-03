// SPDX-License-Identifier: MIT-0
// Small helpers shared by the bundled shards (copied into each one as libreshard.js by
// `npm run shards:base`). Shard authors don't need it: data-key and data-hold work on their own.
// window.Shard is injected after the shard's own scripts, so anything using it waits for LS.ready().
(() => {
  const NAMES = {
    ctrl: 'Ctrl', lctrl: 'Ctrl', rctrl: 'RCtrl', shift: 'Shift', lshift: 'Shift', rshift: 'RShift',
    alt: 'Alt', lalt: 'Alt', ralt: 'AltGr', enter: 'Enter', esc: 'Esc', tab: 'Tab', space: 'Space',
    backspace: '⌫', delete: 'Del', insert: 'Ins', home: 'Home', end: 'End', pageup: 'PgUp', pagedown: 'PgDn',
    up: '↑', down: '↓', left: '←', right: '→', comma: ',', period: '.', minus: '-', equal: '=',
    grave: '`', slash: '/', backslash: '\\', semicolon: ';', apostrophe: "'", lbracket: '[', rbracket: ']',
    numpadplus: 'Num +', numpadminus: 'Num -', numpadmul: 'Num *', numpaddiv: 'Num /', numpaddot: 'Num .',
    numpadenter: 'Num Enter', print: 'Print', printscreen: 'Print', numlock: 'Num Lock', mute: 'Mute', volup: 'Vol+', voldown: 'Vol-', playpause: 'Play', next: 'Next', prev: 'Prev',
  };

  // "ctrl+shift+f13" → "Ctrl+Shift+F13"; the Windows key is "Win" on Windows and "Super" elsewhere
  function keyLabel(combo) {
    const platform = (window.Shard && Shard.platform) || '';
    return String(combo || '').split('+').map((k) => {
      if (k === 'win' || k === 'meta' || k === 'cmd') return platform === 'windows' ? 'Win' : platform === 'mac' ? 'Cmd' : 'Super';
      if (NAMES[k]) return NAMES[k];
      if (/^numpad\d$/.test(k)) return 'Num ' + k.slice(6);
      return k.toUpperCase();
    }).join('+');
  }

  // Sets the combo a button sends, and its visible .ls-key label if it has one. null hides the button.
  function setKey(el, combo, attr = 'key') {
    if (!el) return;
    el.hidden = !combo;
    if (!combo) { delete el.dataset[attr]; return; }
    el.dataset[attr] = combo;
    const label = el.querySelector('.ls-key');
    if (label) label.textContent = keyLabel(combo);
  }

  // The shard's settings now and whenever the user changes them on the PC
  function settings(apply) {
    Shard.settings().then(apply);
    Shard.onSettings(apply);
  }

  // Two-tap confirmation for buttons that shouldn't fire by accident: the first tap arms the
  // button (.is-armed, label from data-armed-i18n), a second one within `ms` runs `action`.
  function confirmTap(el, action, ms = 3000) {
    let timer = null;
    const label = el.querySelector('.ls-label');
    const normal = () => {
      el.classList.remove('is-armed');
      if (label && el.dataset.i18nLabel) label.textContent = Shard.t(el.dataset.i18nLabel);
      timer = null;
    };
    el.addEventListener('click', () => {
      if (timer) { clearTimeout(timer); normal(); action(); return; }
      el.classList.add('is-armed');
      if (label && el.dataset.armedI18n) label.textContent = Shard.t(el.dataset.armedI18n);
      timer = setTimeout(normal, ms);
    });
  }

  // [data-open="id"] shows the sheet with that id; [data-close] hides the sheet it's in
  document.addEventListener('click', (e) => {
    const open = e.target.closest('[data-open]');
    if (open) { const s = document.getElementById(open.dataset.open); if (s) s.hidden = false; }
    const close = e.target.closest('[data-close]');
    if (close) { const s = close.closest('.ls-sheet'); if (s) s.hidden = true; }
  });

  // Held keys ([data-hold]) look pressed while the finger is on them, even if it slides off
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-hold]');
    if (el) el.classList.add('is-active');
  });
  const unhold = (e) => { const el = e.target.closest('[data-hold]'); if (el) el.classList.remove('is-active'); };
  document.addEventListener('pointerup', unhold);
  document.addEventListener('pointercancel', unhold);

  const ready = (fn) => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn());

  window.LS = { keyLabel, setKey, settings, confirmTap, ready };
})();
