// Page script for both the sidebar view and the editor panel.
// Receives {type:'update', sections, graph, state} from the extension and patches the DOM
// section by section, so nothing flickers and scroll position survives every refresh.
(function () {
  'use strict';
  const vscode = acquireVsCodeApi(); // once per document
  const main = document.getElementById('sections');
  const sortState = {}; // table id -> {col, dir}

  // ---- apply an update -----------------------------------------------------------------
  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type !== 'update') return;
    if (typeof msg.sections === 'string') applySections(msg.sections);
    if (msg.graph !== undefined && window.AccessMap) {
      const host = document.getElementById('access-map');
      if (host && msg.graph) window.AccessMap.update(host, msg.graph, { state: msg.state });
    }
    document.body.dataset.state = msg.state || 'idle';
  });

  function applySections(html) {
    const scrollY = window.scrollY;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    const incoming = Array.from(tpl.content.children);
    const existing = new Map();
    for (const el of Array.from(main.children)) {
      const key = el.dataset && el.dataset.section ? el.dataset.section : null;
      if (key) existing.set(key, el);
    }
    const nextChildren = [];
    for (const el of incoming) {
      const key = el.dataset && el.dataset.section;
      const old = key ? existing.get(key) : null;
      if (old && old.outerHTML === el.outerHTML) {
        nextChildren.push(old);          // unchanged: keep the live element
      } else if (old && key === 'accessMap') {
        // The canvas holds layout state; move it across instead of recreating it.
        const oldHost = old.querySelector('.map-host');
        const newHost = el.querySelector('.map-host');
        if (oldHost && newHost) newHost.replaceWith(oldHost);
        const oldLegend = old.querySelector('#map-legend');
        const newLegend = el.querySelector('#map-legend');
        if (oldLegend && newLegend) newLegend.replaceWith(oldLegend);
        nextChildren.push(el);
      } else {
        nextChildren.push(el);
      }
    }
    main.replaceChildren(...nextChildren);
    restoreSort();
    window.scrollTo(0, scrollY);
  }

  // ---- clicks (event delegation, so re-rendered sections keep working) -----------------
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action],[data-open-panel],[data-refresh],[data-open-logs],th[data-col]');
    if (!t) return;
    if (t.hasAttribute('data-action')) {
      if (t.disabled) return;
      vscode.postMessage({ type: 'runAction', index: Number(t.getAttribute('data-action')) });
    } else if (t.hasAttribute('data-open-panel')) {
      vscode.postMessage({ type: 'openPanel' });
    } else if (t.hasAttribute('data-refresh')) {
      vscode.postMessage({ type: 'refresh' });
    } else if (t.hasAttribute('data-open-logs')) {
      vscode.postMessage({ type: 'openLogs' });
    } else if (t.matches('th[data-col]')) {
      const table = t.closest('table');
      const id = table.dataset.table || 'table';
      const col = Number(t.dataset.col);
      const cur = sortState[id];
      const dir = cur && cur.col === col && cur.dir === 'desc' ? 'asc' : 'desc';
      sortState[id] = { col, dir };
      sortTable(table, col, dir);
    }
  });

  // ---- table sorting -------------------------------------------------------------------
  function sortTable(table, col, dir) {
    const tbody = table.tBodies[0];
    if (!tbody) return;
    const rows = Array.from(tbody.rows);
    const key = (row) => {
      const cell = row.cells[col];
      if (!cell) return '';
      const s = cell.dataset.sort;
      if (s === undefined) return cell.textContent.trim().toLowerCase();
      const n = Number(s);
      return isNaN(n) ? s : n;
    };
    rows.sort((a, b) => {
      const ka = key(a), kb = key(b);
      const c = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : String(ka).localeCompare(String(kb));
      return dir === 'asc' ? c : -c;
    });
    tbody.replaceChildren(...rows);
    for (const th of table.tHead.rows[0].cells) th.classList.remove('sorted-asc', 'sorted-desc');
    const th = table.tHead.rows[0].cells[col];
    if (th) th.classList.add(dir === 'asc' ? 'sorted-asc' : 'sorted-desc');
  }

  function restoreSort() {
    for (const table of main.querySelectorAll('table.sortable')) {
      const st = sortState[table.dataset.table || 'table'];
      if (st) sortTable(table, st.col, st.dir);
    }
  }

  vscode.postMessage({ type: 'ready' });
})();
