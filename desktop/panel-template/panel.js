// SPDX-License-Identifier: MIT-0
// Draws a panel made with LibreShard's editor. The panel comes from layout.js (window.LS_PANEL,
// generated from panel.json); the editor's preview calls LibrePanel.render() with its own copy.
// Buttons get data-key / data-hold / data-repeat, so the viewer's shard API presses the keys; only
// toggles and page buttons are handled here. Texts always go in with textContent, never as HTML.
// window.Shard is injected after this script and doesn't exist in the editor's preview, so drawing
// never needs it: only tapping a toggle and remembering its state do.
(() => {
  const FONTS = { mono: 'var(--ls-mono)', serif: 'Georgia, Cambria, "Times New Roman", serif' };
  const SCALE = { s: '0.85', l: '1.2' };
  const GAPS = { compact: 'clamp(4px, .8vmin, 8px)', wide: 'clamp(12px, 2.4vmin, 24px)' };

  const make = (tag, cls, text) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text) el.textContent = text;
    return el;
  };

  // "#1a3150" → [26, 49, 80]
  const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const darker = (hex, k = 0.72) => '#' + rgb(hex).map((c) => Math.round(c * k).toString(16).padStart(2, '0')).join('');
  // Dark text on light colors, light text on dark ones
  const readableOn = (hex) => {
    const [r, g, b] = rgb(hex).map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#0d1b2a' : '#ffffff';
  };
  const fill = (kind, hex) => (kind === 'none' ? 'transparent' : kind === 'flat' ? hex : `linear-gradient(180deg, ${hex}, ${darker(hex)})`);

  function keyLabel(combo) {
    return window.LS && LS.keyLabel ? LS.keyLabel(combo) : combo;
  }

  // The panel's look (panel.json "style") as --lsp-* variables on <html>, and the background on <body>
  function applyStyle(doc, style, imageUrl) {
    const root = doc.documentElement.style;
    const set = (name, value) => (value == null ? root.removeProperty(name) : root.setProperty(name, value));
    const s = style || {};
    const b = s.button || {};
    const bg = s.background;
    let background = null;
    if (bg?.kind === 'color') background = bg.color;
    else if (bg?.kind === 'gradient') background = `linear-gradient(160deg, ${bg.colors[0]}, ${bg.colors[1]})`;
    else if (bg?.kind === 'image') {
      const dim = (bg.dim || 0) / 100;
      background = `linear-gradient(rgba(0,0,0,${dim}), rgba(0,0,0,${dim})), url("${imageUrl(bg.file)}") center / cover no-repeat, #000`;
    }
    set('--lsp-bg', background);
    set('--lsp-fill', b.color || b.fill ? fill(b.fill || 'gradient', b.color || '#1a3150') : null);
    set('--lsp-border', b.border != null ? b.border + 'px' : null);
    set('--lsp-border-color', b.borderColor || null);
    // The radius is for an 800 px tall tablet and shrinks with smaller screens, like --ls-radius
    set('--lsp-radius', b.radius != null ? `min(${b.radius}px, ${b.radius * 0.125}vmin)` : null);
    set('--lsp-shadow', b.shadow ? '0 3px 10px rgba(0, 0, 0, .45)' : null);
    set('--lsp-active', b.activeColor || null);
    set('--lsp-active-text', b.activeColor ? readableOn(b.activeColor) : null);
    set('--lsp-text', s.text?.color || null);
    set('--lsp-scale', SCALE[s.text?.size] || null);
    set('--lsp-font', FONTS[s.text?.font] || null);
    set('--ls-gap', GAPS[s.spacing] || null);
    return b.imageFit === 'bleed';
  }

  function content(btn, look, imageUrl) {
    const icon = look.icon;
    const parts = [];
    if (icon?.kind === 'image') {
      const img = make('img', 'lsp-img');
      img.alt = '';
      img.src = imageUrl(icon.file);
      btn.classList.add('lsp-has-img');
      btn.append(img);
    } else if (icon?.kind === 'builtin') parts.push(make('span', 'ls-i i-' + icon.name));
    else if (icon?.kind === 'emoji') parts.push(make('span', 'lsp-emoji', icon.text));
    if (look.label) {
      const label = make('span', 'lsp-text', look.label);
      if (look.labelSize && look.labelSize !== 'm') label.classList.add('lsp-' + look.labelSize);
      if (look.labelPos === 'top') parts.unshift(label); else parts.push(label);
    } else if (!icon && look.key) {
      // Nothing else to show: the key itself
      parts.push(make('span', 'ls-key', keyLabel(look.key)));
    }
    // Where the text goes: over an image at the bottom unless chosen otherwise; without an image
    // the icon and text stay together, in the middle unless a position was chosen
    const pos = look.labelPos || (icon?.kind === 'image' ? 'bottom' : 'middle');
    if (pos !== 'middle') btn.classList.add('lsp-' + pos);
    btn.append(...parts);
    const fillKind = (panelStyle.button || {}).fill || 'gradient';
    if (look.color) btn.style.setProperty(btn.classList.contains('lsp-label') ? '--lsp-label-fill' : '--lsp-fill', fill(fillKind === 'none' ? 'flat' : fillKind, look.color));
    if (look.textColor) btn.style.setProperty('--lsp-text', look.textColor);
  }

  let panelStyle = {};

  // Draws `panel` inside `root` (an empty element). opts: { name, page, images: { "images/…": url } }.
  // Returns { showPage(id) }.
  function render(panel, root, opts = {}) {
    const doc = root.ownerDocument;
    const images = opts.images || {};
    const imageUrl = (file) => images[file] || file;
    const pages = panel.pages;
    panelStyle = panel.style || {};
    const saved = { toggles: {}, page: null };
    const history = [];
    let current = 0;

    root.replaceChildren();
    root.classList.add('ls-app', 'lsp');
    doc.body.classList.add('lsp-body');
    root.classList.toggle('lsp-bleed', applyStyle(doc, panel.style, imageUrl));

    const head = make('header', 'ls-head');
    const title = make('h1', 'ls-title', opts.name || '');
    const tabs = make('nav', 'lsp-tabs');
    head.append(title, tabs);
    const body = make('section', 'ls-body');
    const grid = make('div', 'lsp-grid');
    grid.style.gridTemplateColumns = `repeat(${panel.grid.cols}, minmax(0, 1fr))`;
    grid.style.gridTemplateRows = `repeat(${panel.grid.rows}, minmax(0, 1fr))`;
    body.append(grid);
    root.append(head, body);
    if (opts.name) doc.title = opts.name;

    const showTabs = panel.pageBar !== false && pages.length > 1;
    tabs.hidden = !showTabs;
    if (showTabs) {
      for (const [i, p] of pages.entries()) {
        const tab = make('button', 'lsp-tab', p.name);
        tab.type = 'button';
        tab.addEventListener('click', () => go(i, true));
        tabs.append(tab);
      }
    }

    const remember = () => { if (window.Shard) Shard.save(saved); };

    function button(b) {
      let look = b.type === 'toggle' && saved.toggles[b.id] && b.alt ? { ...b, ...b.alt } : b;
      // A page button with nothing to show says where it goes
      if (b.type === 'page' && !look.label && !look.icon) {
        const target = { back: '↩', next: '→', prev: '←' }[b.page] || '→ ' + (pages.find((p) => p.id === b.page)?.name || '');
        look = { ...look, label: target };
      }
      const tag = b.type === 'label' || b.type === 'none' ? 'div' : 'button';
      const el = make(tag, 'ls-btn lsp-btn' + (b.type === 'label' ? ' lsp-label' : b.type === 'none' ? ' lsp-none' : ''));
      el.dataset.id = b.id;
      el.style.gridColumn = `${b.col + 1} / span ${b.w}`;
      el.style.gridRow = `${b.row + 1} / span ${b.h}`;
      if (tag === 'button') el.type = 'button';
      if (b.type === 'press') el.dataset.key = b.key;
      else if (b.type === 'hold') el.dataset.hold = b.key;
      else if (b.type === 'repeat') { el.dataset.key = b.key; el.dataset.repeat = String(b.repeat); }
      else if (b.type === 'none') el.setAttribute('aria-disabled', 'true');
      content(el, look, imageUrl);
      if (!look.label && tag === 'button') {
        const what = b.key || (b.keys && b.keys[saved.toggles[b.id] ? 1 : 0]) || (b.type === 'page' ? b.page : '');
        if (what) el.setAttribute('aria-label', keyLabel(what));
      }
      if (b.type === 'toggle') {
        el.setAttribute('aria-pressed', String(!!saved.toggles[b.id]));
        el.addEventListener('click', () => {
          const on = !!saved.toggles[b.id];
          if (window.Shard) Shard.press(b.keys[on ? 1 : 0]);
          if (on) delete saved.toggles[b.id]; else saved.toggles[b.id] = 1;
          remember();
          el.replaceWith(button(b));
        });
      } else if (b.type === 'page') {
        el.addEventListener('click', () => {
          if (b.page === 'back') { if (history.length) go(history.pop(), false); }
          else if (b.page === 'next') go((current + 1) % pages.length, true);
          else if (b.page === 'prev') go((current - 1 + pages.length) % pages.length, true);
          else go(pages.findIndex((p) => p.id === b.page), true);
        });
      }
      return el;
    }

    function draw() {
      grid.replaceChildren(...pages[current].buttons.map(button));
      for (const [i, tab] of [...tabs.children].entries()) tab.setAttribute('aria-pressed', String(i === current));
    }

    function go(i, push) {
      if (i < 0 || i >= pages.length || i === current) return;
      if (push) { history.push(current); if (history.length > 50) history.shift(); }
      current = i;
      saved.page = pages[i].id;
      remember();
      draw();
    }

    const start = pages.findIndex((p) => p.id === opts.page);
    current = start >= 0 ? start : 0;
    draw();

    // The page and toggles this tablet had, once the viewer answers (the redraw is cheap)
    if (window.Shard && opts.restore !== false) {
      Shard.load().then((d) => {
        if (!d || typeof d !== 'object') return;
        if (d.toggles && typeof d.toggles === 'object') {
          for (const p of pages) for (const b of p.buttons) if (b.type === 'toggle' && d.toggles[b.id] === 1) saved.toggles[b.id] = 1;
        }
        const i = pages.findIndex((p) => p.id === d.page);
        if (i >= 0 && opts.page === undefined) { current = i; saved.page = d.page; }
        draw();
      });
    }

    return { showPage: (id) => { const i = pages.findIndex((p) => p.id === id); if (i >= 0) { current = i; draw(); } } };
  }

  window.LibrePanel = { render };

  if (window.LS_PANEL) {
    const start = () => render(window.LS_PANEL, document.getElementById('panel'), { name: window.LS_PANEL_NAME });
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  }
})();
