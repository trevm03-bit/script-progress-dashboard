// Page script for the sidebar view, the editor-tab dashboard and the map tab.
// Receives {type:'update', ...} from the extension and patches the DOM section by section, so
// nothing flickers and scroll position, filters, sort and the map's layout survive every refresh.
(function () {
  'use strict';
  const vscode = acquireVsCodeApi(); // once per document
  const main = document.getElementById('sections');
  const sortState = {};                     // table id -> {col, dir}
  const filterState = { text: '', kind: 'all' };
  const openDetails = new Set();            // run keys whose detail row is open
  let collapsed = new Set();
  let collapsible = true;
  const isMapSurface = document.body.classList.contains('surface-map');

  // ---- map plumbing --------------------------------------------------------------------
  const mapApi = {
    post: m => {
      if (m && m.type === 'filterHistory' && !isMapSurface) {
        // Handle locally when the history table is on this page.
        const sec = main.querySelector('section[data-section="runHistory"]');
        const input = sec && sec.querySelector('.filter-text');
        if (input) {
          input.value = m.text || '';
          filterState.text = (m.text || '').trim().toLowerCase();
          applyFilters(sec);
          sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
      }
      vscode.postMessage(m);
    },
    getState: () => { try { return (vscode.getState() || {}).map || null; } catch { return null; } },
    setState: s => { try { const st = vscode.getState() || {}; st.map = s; vscode.setState(st); } catch { /* ignore */ } },
  };
  let lastGraph = null;
  let lastMapOptions = {};

  function mapSections() { return Array.from(main.querySelectorAll('section[data-section="accessMap"]')); }
  function feedMaps() {
    if (!lastGraph || !window.AccessMap) return;
    for (const sec of mapSections()) {
      const host = sec.querySelector('.map-host');
      if (!host) continue;
      if (host.classList.contains('map-host-mini')) window.AccessMap.mini(host, lastGraph, mapApi);
      else window.AccessMap.update(sec, lastGraph, Object.assign({ api: mapApi }, lastMapOptions));
    }
  }

  // ---- apply an update -----------------------------------------------------------------
  window.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type !== 'update') return;
    if (Array.isArray(msg.collapsed)) collapsed = new Set(msg.collapsed);
    if (typeof msg.collapsible === 'boolean') collapsible = msg.collapsible;
    if (msg.density) { document.body.classList.remove('density-comfortable', 'density-compact'); document.body.classList.add('density-' + msg.density); }
    if (typeof msg.sections === 'string' && !isMapSurface) applySections(msg.sections);
    if (msg.mapOptions) lastMapOptions = msg.mapOptions;
    if (msg.graph !== undefined) lastGraph = msg.graph;
    if (msg.graph !== undefined || typeof msg.sections === 'string' || isMapSurface) feedMaps();
    if (msg.replay && window.AccessMap) for (const sec of mapSections()) window.AccessMap.replay(sec, msg.replay);
    document.body.dataset.state = msg.state || 'idle';
    if (msg.status) applyStatus(msg.status);
  });

  function applyStatus(st) {
    const pill = document.getElementById('status-pill');
    if (pill) {
      pill.dataset.state = st.running ? 'running' : st.state;
      const t = pill.querySelector('.pill-text');
      if (t) t.textContent = st.text;
      pill.title = st.logsDir ? 'Reading ' + st.logsDir : '';
    }
    const up = document.getElementById('updated');
    if (up) up.textContent = st.updated ? 'updated ' + st.updated : '';
  }

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
    const next = [];
    for (const el of incoming) {
      const key = el.dataset && el.dataset.section;
      const old = key ? existing.get(key) : null;
      if (old && old.outerHTML === el.outerHTML) { next.push(old); continue; }
      if (old && key === 'accessMap') {
        for (const sel of ['.map-host', '.map-toolbar', '.map-legend']) {
          const o = old.querySelector(sel), n = el.querySelector(sel);
          if (o && n && (sel !== '.map-host' || o.classList.contains('map-host-mini') === n.classList.contains('map-host-mini'))) n.replaceWith(o);
        }
      }
      if (old && key === 'runHistory') {
        const oi = old.querySelector('.filter-text'), ni = el.querySelector('.filter-text');
        if (oi && ni) ni.value = oi.value;
      }
      next.push(el);
    }
    main.replaceChildren(...next);
    restoreSort();
    restoreFilters();
    restoreDetails();
    window.scrollTo(0, scrollY);
  }

  // ---- clicks (event delegation, so re-rendered sections keep working) -----------------
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-action],[data-msg],[data-open],[data-filter-task],th[data-col],.section-title.toggle,tr.expandable,.fchip');
    if (!t) return;
    if (t.hasAttribute('data-action')) {
      if (t.disabled) return;
      vscode.postMessage({ type: 'runAction', index: Number(t.getAttribute('data-action')) });
    } else if (t.hasAttribute('data-msg')) {
      // data-key rides along for messages that name a specific run (Compare with…).
      const key = t.getAttribute('data-key');
      vscode.postMessage(key ? { type: t.getAttribute('data-msg'), key } : { type: t.getAttribute('data-msg') });
    } else if (t.hasAttribute('data-open')) {
      vscode.postMessage({ type: 'openFile', path: t.getAttribute('data-open') });
    } else if (t.hasAttribute('data-filter-task')) {
      mapApi.post({ type: 'filterHistory', text: t.getAttribute('data-filter-task') });
    } else if (t.matches('th[data-col]')) {
      const table = t.closest('table');
      const id = table.dataset.table || 'table';
      const col = Number(t.dataset.col);
      const cur = sortState[id];
      const dir = cur && cur.col === col && cur.dir === 'desc' ? 'asc' : 'desc';
      sortState[id] = { col, dir };
      sortTable(table, col, dir);
    } else if (t.matches('.section-title.toggle')) {
      if (!collapsible) return;
      const sec = t.closest('section');
      const id = sec.dataset.section;
      const now = !sec.classList.contains('collapsed');
      setCollapsed(sec, now);
      if (now) collapsed.add(id); else collapsed.delete(id);
      vscode.postMessage({ type: 'collapse', id, collapsed: now });
    } else if (t.matches('tr.expandable')) {
      if (e.target.closest('button, a')) return;
      const detail = t.nextElementSibling;
      if (!detail || !detail.classList.contains('detail')) return;
      const key = rowKey(t);
      const open = detail.hidden;
      detail.hidden = !open;
      t.classList.toggle('open', open);
      if (open) openDetails.add(key); else openDetails.delete(key);
    } else if (t.matches('.fchip')) {
      filterState.kind = t.dataset.filter || 'all';
      applyFilters(t.closest('section'));
    }
  });
  document.addEventListener('keydown', (e) => {
    const t = e.target;
    if ((e.key === 'Enter' || e.key === ' ') && t.matches && (t.matches('.section-title.toggle') || t.matches('tr.expandable'))) { e.preventDefault(); t.click(); }
  });
  document.addEventListener('input', (e) => {
    if (e.target.matches && e.target.matches('.filter-text')) {
      filterState.text = e.target.value.trim().toLowerCase();
      applyFilters(e.target.closest('section'));
    }
  });

  function setCollapsed(sec, isCollapsed) {
    sec.classList.toggle('collapsed', isCollapsed);
    const body = sec.querySelector(':scope > .section-body');
    if (body) body.hidden = isCollapsed;
    const chev = sec.querySelector(':scope > .section-title .chev');
    if (chev) chev.className = 'codicon codicon-chevron-' + (isCollapsed ? 'right' : 'down') + ' chev';
    const title = sec.querySelector(':scope > .section-title');
    if (title) title.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
  }

  // ---- run history: sort, filter, detail ---------------------------------------------
  function rowKey(tr) {
    const task = tr.querySelector('.col-task'), date = tr.querySelector('.col-date');
    return (task ? task.textContent.trim() : '') + '|' + (date ? date.dataset.sort : '');
  }
  function sortTable(table, col, dir) {
    const tbody = table.tBodies[0];
    if (!tbody) return;
    const pairs = [];
    for (const row of Array.from(tbody.rows)) {
      if (row.classList.contains('detail')) { if (pairs.length) pairs[pairs.length - 1].push(row); continue; }
      pairs.push([row]);
    }
    const key = (row) => {
      const cell = row.cells[col];
      if (!cell) return '';
      const s = cell.dataset.sort;
      if (s === undefined) return cell.textContent.trim().toLowerCase();
      const n = Number(s);
      return isNaN(n) ? s : n;
    };
    pairs.sort((a, b) => {
      const ka = key(a[0]), kb = key(b[0]);
      const c = typeof ka === 'number' && typeof kb === 'number' ? ka - kb : String(ka).localeCompare(String(kb));
      return dir === 'asc' ? c : -c;
    });
    tbody.replaceChildren(...pairs.flat());
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
  function applyFilters(sec) {
    if (!sec) return;
    for (const chip of sec.querySelectorAll('.fchip')) chip.classList.toggle('active', (chip.dataset.filter || 'all') === filterState.kind);
    let shown = 0, total = 0;
    for (const tr of sec.querySelectorAll('tbody tr')) {
      if (tr.classList.contains('detail')) continue;
      total++;
      const kinds = (tr.dataset.kinds || '').split(' ');
      const okKind = filterState.kind === 'all' || kinds.includes(filterState.kind);
      const okText = !filterState.text || (tr.dataset.hay || tr.textContent.toLowerCase()).includes(filterState.text);
      const show = okKind && okText;
      tr.classList.toggle('hide', !show);
      const detail = tr.nextElementSibling;
      if (detail && detail.classList.contains('detail')) detail.classList.toggle('hide', !show);
      if (show) shown++;
    }
    const foot = sec.querySelector('.table-foot .shown');
    if (foot && (filterState.text || filterState.kind !== 'all')) foot.textContent = `Showing ${shown} of ${total} loaded runs`;
  }
  function restoreFilters() {
    const sec = main.querySelector('section[data-section="runHistory"]');
    if (!sec) return;
    const input = sec.querySelector('.filter-text');
    if (input && input.value.trim().toLowerCase() !== filterState.text) input.value = filterState.text;
    if (filterState.text || filterState.kind !== 'all') applyFilters(sec);
  }
  function restoreDetails() {
    if (!openDetails.size) return;
    for (const tr of main.querySelectorAll('tr.expandable')) {
      if (openDetails.has(rowKey(tr))) {
        const d = tr.nextElementSibling;
        if (d && d.classList.contains('detail')) { d.hidden = false; tr.classList.add('open'); }
      }
    }
  }

  if (isMapSurface && window.AccessMap) {
    for (const sec of mapSections()) window.AccessMap.attach(sec, mapApi);
  }

  vscode.postMessage({ type: 'ready' });
})();
