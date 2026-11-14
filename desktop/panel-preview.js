// The panel editor's canvas. It draws the panel with the tablet's own code (LibrePanel.render from
// panel-template/panel.js) and turns pointer input into editing messages for the editor, which owns
// the panel and sends it back to draw. It never presses keys: there is no Shard API here.
//
// From the editor: hello (answered with ready) · { t: 'render', panel, name, images, page, selected }
// To the editor:   ready · select { id } · create { col, row } · move { id, col, row } ·
//                  resize { id, w, h } · page { id } · small { ids } · key { key, ctrl, shift, alt }
(() => {
  const root = document.getElementById('panel');
  let last = null; // the last render message, to draw again after a refused drag
  let drag = null;

  const post = (msg) => parent.postMessage(msg, '*');
  const page = () => last.panel.pages.find((p) => p.id === last.page) || last.panel.pages[0];
  const grid = () => root.querySelector('.lsp-grid');

  window.addEventListener('message', (e) => {
    if (e.source !== parent || !e.data) return;
    if (e.data.t === 'hello') { post({ t: 'ready' }); return; }
    if (e.data.t !== 'render') return;
    last = e.data;
    draw();
  });

  // A button that can't do anything yet (no key chosen, no page to open)
  const incomplete = (b) => (['press', 'hold', 'repeat'].includes(b.type) && !b.key) ||
    (b.type === 'toggle' && (!b.keys || b.keys.length !== 2 || !b.keys[0] || !b.keys[1])) ||
    (b.type === 'page' && !b.page);

  function draw() {
    const { panel } = last;
    const p = page();
    LibrePanel.render(panel, root, { name: last.name, images: last.images, page: p.id, restore: false });
    const g = grid();
    const { cols, rows } = panel.grid;
    g.classList.toggle('ed-fine', cols * rows >= 144);
    const taken = new Set();
    for (const b of p.buttons) for (let c = b.col; c < b.col + b.w; c++) for (let r = b.row; r < b.row + b.h; r++) taken.add(c + ',' + r);
    const cells = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (taken.has(c + ',' + r)) continue;
        const cell = document.createElement('div');
        cell.className = 'ed-cell';
        cell.dataset.col = c;
        cell.dataset.row = r;
        cell.style.gridColumn = String(c + 1);
        cell.style.gridRow = String(r + 1);
        cells.push(cell);
      }
    }
    g.prepend(...cells);
    for (const el of g.querySelectorAll('[data-id]')) {
      const b = p.buttons.find((x) => x.id === el.dataset.id);
      if (b && incomplete(b)) el.classList.add('ed-incomplete');
      if (el.dataset.id === last.selected) {
        el.classList.add('ed-sel');
        const handle = document.createElement('div');
        handle.className = 'ed-handle';
        el.append(handle);
      }
    }
    // Buttons under 48 px at this preview size are hard to hit with a finger
    requestAnimationFrame(() => {
      const small = [];
      for (const el of g.querySelectorAll('[data-id]')) {
        const r = el.getBoundingClientRect();
        if (r.width < 48 || r.height < 48) { small.push(el.dataset.id); el.classList.add('ed-small'); }
      }
      post({ t: 'small', ids: small });
    });
  }

  // The grid cell under a point (the nearest one when outside the grid)
  function cellAt(e) {
    const g = grid();
    const rect = g.getBoundingClientRect();
    const style = getComputedStyle(g);
    const gapX = parseFloat(style.columnGap) || 0;
    const gapY = parseFloat(style.rowGap) || 0;
    const { cols, rows } = last.panel.grid;
    const clamp = (v, max) => Math.max(0, Math.min(max, v));
    return {
      col: clamp(Math.floor((e.clientX - rect.left) / ((rect.width + gapX) / cols)), cols - 1),
      row: clamp(Math.floor((e.clientY - rect.top) / ((rect.height + gapY) / rows)), rows - 1),
    };
  }

  // Whether a button could sit there: inside the grid and over no other button
  function fits(id, col, row, w, h) {
    const { cols, rows } = last.panel.grid;
    if (col < 0 || row < 0 || col + w > cols || row + h > rows) return false;
    return !page().buttons.some((b) => b.id !== id && col < b.col + b.w && b.col < col + w && row < b.row + b.h && b.row < row + h);
  }

  const place = (el, col, row, w, h) => {
    el.style.gridColumn = `${col + 1} / span ${w}`;
    el.style.gridRow = `${row + 1} / span ${h}`;
  };

  // Capture phase on the window: the panel's own handlers (toggles, page buttons, held keys) never
  // see the editor's clicks
  window.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (!last || e.button > 0) return;
    const tab = e.target.closest('.lsp-tab');
    if (tab) {
      const i = [...tab.parentNode.children].indexOf(tab);
      post({ t: 'page', id: last.panel.pages[i].id });
      return;
    }
    const el = e.target.closest('[data-id]');
    if (el) {
      const b = page().buttons.find((x) => x.id === el.dataset.id);
      if (!b) return;
      const kind = e.target.closest('.ed-handle') ? 'resize' : 'move';
      drag = { kind, el, b, start: cellAt(e), x: e.clientX, y: e.clientY, moved: false, to: null };
      try { el.setPointerCapture(e.pointerId); } catch {}
      return;
    }
    const cell = e.target.closest('.ed-cell');
    if (cell) post({ t: 'create', col: Number(cell.dataset.col), row: Number(cell.dataset.row) });
    else post({ t: 'select', id: null });
  }, true);

  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    e.stopPropagation();
    if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
    drag.moved = true;
    const { b, el } = drag;
    const c = cellAt(e);
    const { cols, rows } = last.panel.grid;
    if (drag.kind === 'move') {
      const col = Math.max(0, Math.min(cols - b.w, b.col + c.col - drag.start.col));
      const row = Math.max(0, Math.min(rows - b.h, b.row + c.row - drag.start.row));
      drag.to = { col, row, w: b.w, h: b.h };
    } else {
      drag.to = { col: b.col, row: b.row, w: Math.max(1, c.col - b.col + 1), h: Math.max(1, c.row - b.row + 1) };
    }
    const t = drag.to;
    place(el, t.col, t.row, t.w, t.h);
    el.classList.add('ed-dragging');
    el.classList.toggle('ed-bad', !fits(b.id, t.col, t.row, t.w, t.h));
  }, true);

  const endDrag = (e) => {
    if (!drag) return;
    e.stopPropagation();
    const { b, to, moved, kind } = drag;
    drag = null;
    if (!moved || !to) { post({ t: 'select', id: b.id }); return; }
    if (!fits(b.id, to.col, to.row, to.w, to.h) || (to.col === b.col && to.row === b.row && to.w === b.w && to.h === b.h)) { draw(); return; }
    if (kind === 'move') post({ t: 'move', id: b.id, col: to.col, row: to.row });
    else post({ t: 'resize', id: b.id, w: to.w, h: to.h });
  };
  window.addEventListener('pointerup', endDrag, true);
  window.addEventListener('pointercancel', (e) => { if (drag) { drag = null; draw(); } e.stopPropagation(); }, true);
  for (const type of ['click', 'contextmenu']) {
    window.addEventListener(type, (e) => { e.stopPropagation(); e.preventDefault(); }, true);
  }

  // Shortcuts pressed while the canvas has the focus go to the editor
  window.addEventListener('keydown', (e) => {
    post({ t: 'key', key: e.key, ctrl: e.ctrlKey || e.metaKey, shift: e.shiftKey, alt: e.altKey });
    e.preventDefault();
  });

  for (const type of ['dragover', 'drop']) window.addEventListener(type, (e) => e.preventDefault());

  post({ t: 'ready' });
})();
