// Injected into every shard. It never talks to the PC directly: it only messages the viewer.
(() => {
  const post = (msg) => parent.postMessage(Object.assign({ __shard: true }, msg), '*');
  const send = (t, keys) => post({ t, keys });

  // The viewer's replies to Shard.load() and Shard.settings(), and settings changed on the PC
  let reqId = 0;
  const waiting = new Map();
  const settingsListeners = [];
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== parent || !d || !d.__libreshard) return;
    if (d.t === 'settings' && d.id === undefined) {
      for (const cb of settingsListeners) { try { cb(d.values || {}); } catch (err) { console.error(err); } }
      return;
    }
    if (d.t !== 'data' && d.t !== 'settings') return;
    // d.id comes from the message: only an id this script is waiting for calls anything
    if (typeof d.id !== 'number' || !waiting.has(d.id)) return;
    const done = waiting.get(d.id);
    waiting.delete(d.id);
    if (typeof done === 'function') done(d.t === 'data' ? d.data : d.values);
  });

  // Asks the viewer and waits for its answer; without a viewer (shard opened on its own) there is none
  function ask(msg, fallback, parseReply) {
    return new Promise((resolve) => {
      const id = ++reqId;
      waiting.set(id, (v) => resolve(parseReply(v)));
      post(Object.assign({ id }, msg));
      setTimeout(() => { if (waiting.delete(id)) resolve(fallback); }, 1500);
    });
  }

  // Language and the PC's system, passed by the viewer in the URL (?lang=es&os=windows)
  const query = new URLSearchParams(location.search);
  const lang = (query.get('lang') || navigator.language || 'en').toLowerCase();
  const platform = query.get('os') || '';

  // Optional translations: a shard may define window.SHARD_STRINGS = { en: {...}, es: {...} } (for
  // example in its own strings.js, loaded before this script). Lookup order: exact language, its
  // base ("pt" for "pt-br"), English, then the key itself.
  const dicts = (window.SHARD_STRINGS && typeof window.SHARD_STRINGS === 'object') ? window.SHARD_STRINGS : null;
  const chain = dicts ? [dicts[lang], dicts[lang.split('-')[0]], dicts.en].filter((d) => d && typeof d === 'object') : [];
  function t(key, vars) {
    let s = key;
    for (const d of chain) if (typeof d[key] === 'string') { s = d[key]; break; }
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
  }
  // Fills [data-i18n] (text) and [data-i18n-aria] (aria-label) inside root
  function translate(root) {
    if (!chain.length) return;
    root = root || document;
    for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
    for (const el of root.querySelectorAll('[data-i18n-aria]')) el.setAttribute('aria-label', t(el.dataset.i18nAria));
  }
  if (dicts) {
    const used = [lang, lang.split('-')[0]].find((l) => dicts[l]) || (dicts.en ? 'en' : null);
    if (used) document.documentElement.lang = used;
  }

  window.Shard = {
    lang,
    platform, // 'windows', 'linux', 'mac' or '' when unknown (the shard opened on its own)
    t,
    translate,
    press: (k) => send('press', k),
    hold: (k) => send('down', k),
    release: (k) => send('up', k),
    // The shard's own data (JSON, max 64 KB), stored by the viewer on the tablet.
    // load() returns a promise with the saved data or null.
    save: (data) => post({ t: 'save', data: JSON.stringify(data) }),
    load: () => ask({ t: 'load' }, null, (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } }),
    // The settings the user chose on the PC for this shard (declared in its manifest), as
    // { id: value }. onSettings(cb) calls cb with the new values whenever they change.
    settings: () => ask({ t: 'settings' }, {}, (v) => v || {}),
    onSettings: (cb) => { if (typeof cb === 'function') settingsListeners.push(cb); },
  };

  translate();

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-key]');
    if (!el) return;
    // A [data-repeat] button already pressed on pointerdown; a click from the keyboard (detail 0) didn't
    if (el.hasAttribute('data-repeat') && e.detail !== 0) return;
    Shard.press(el.dataset.key);
  });

  // Browsers only fire click for the primary pointer, so a [data-key] tapped with a second finger
  // (while the first one holds a [data-hold], say Alt + Tab) is pressed on its pointerup instead,
  // if the finger lifts over the same button.
  const secondary = new Map(); // pointerId → button
  document.addEventListener('pointerdown', (e) => {
    if (e.isPrimary) return;
    const el = e.target.closest('[data-key]:not([data-repeat])');
    if (el) secondary.set(e.pointerId, el);
  });
  document.addEventListener('pointerup', (e) => {
    const el = secondary.get(e.pointerId);
    if (!el) return;
    secondary.delete(e.pointerId);
    const over = document.elementFromPoint(e.clientX, e.clientY);
    if (over && el.contains(over)) Shard.press(el.dataset.key);
  });
  document.addEventListener('pointercancel', (e) => secondary.delete(e.pointerId));

  // [data-key][data-repeat]: presses at once and, while the finger stays on it, again every
  // data-repeat ms (100 by default, 50–1000) after a 400 ms pause. Stops on release, on cancel and
  // when the page is hidden. For keys a held press wouldn't repeat, such as the volume.
  let repeat = null;
  function stopRepeat() {
    if (!repeat) return;
    clearTimeout(repeat.timer);
    clearInterval(repeat.interval);
    repeat = null;
  }
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-key][data-repeat]');
    if (!el) return;
    stopRepeat();
    try { el.setPointerCapture(e.pointerId); } catch {}
    const every = Math.min(1000, Math.max(50, parseInt(el.dataset.repeat, 10) || 100));
    const keys = el.dataset.key;
    Shard.press(keys);
    repeat = { el, pointer: e.pointerId };
    repeat.timer = setTimeout(() => { if (repeat) repeat.interval = setInterval(() => Shard.press(keys), every); }, 400);
  });
  const endRepeat = (e) => { if (repeat && e.pointerId === repeat.pointer) stopRepeat(); };
  document.addEventListener('pointerup', endRepeat);
  document.addEventListener('pointercancel', endRepeat);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopRepeat(); });
  window.addEventListener('blur', stopRepeat);
  document.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('[data-hold]');
    if (!el) return;
    // Capture the pointer: pointerup reaches this button even if the finger or mouse leaves it
    try { el.setPointerCapture(e.pointerId); } catch {}
    Shard.hold(el.dataset.hold);
  });
  const up = (e) => {
    const el = e.target.closest('[data-hold]');
    if (el) Shard.release(el.dataset.hold);
  };
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', up);
})();
