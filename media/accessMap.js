// Access Map: a constellation of scripts (tasks) and the resources they touch, with data lineage.
// Plain Canvas 2D, no libraries. Everything visual reads its colour from VS Code theme variables.
//
//   window.AccessMap.attach(section, api)                    wire a section's toolbar + canvas (once)
//   window.AccessMap.update(section, graph, options)         new data / options
//   window.AccessMap.replay(section, replay)                 animate one finished run's path
//   window.AccessMap.mini(host, graph)                       static preview for the sidebar
//
// Interaction: drag background = pan · wheel = zoom about the cursor · drag a node = move (pins it)
// · click = focus + lineage + detail card · right-click = menu · double-click = reset · search box
// · legend = hide a type · keys: F fit, R re-layout, / search, Esc clear, +/- zoom.
// Honours prefers-reduced-motion (no particles, instant layouts).
(function () {
  'use strict';

  const TYPE_ORDER = ['task', 'table', 'file', 'api', 'other'];
  const TYPE_LABEL = { task: 'Script', table: 'Table / view', file: 'File', api: 'API / service', other: 'Other' };
  const TYPE_VAR = { task: '--vscode-charts-blue', table: '--vscode-charts-purple', file: '--vscode-charts-orange', api: '--vscode-charts-green', other: '--vscode-charts-yellow' };
  const FALLBACK = { task: '#3794ff', table: '#b180d7', file: '#d18616', api: '#89d185', other: '#cca700' };
  const reducedMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const instances = new WeakMap();

  // ---------------------------------------------------------------- helpers
  function css(name, fallback) {
    const v = getComputedStyle(document.body).getPropertyValue(name).trim();
    return v || fallback;
  }
  function withAlpha(color, a) {
    if (!color) return `rgba(128,128,128,${a})`;
    if (color[0] === '#') {
      let h = color.slice(1);
      if (h.length === 3) h = h.split('').map(c => c + c).join('');
      const n = parseInt(h.slice(0, 6), 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    }
    const m = color.match(/rgba?\(([^)]+)\)/);
    if (m) { const p = m[1].split(',').map(s => s.trim()); return `rgba(${p[0]},${p[1]},${p[2]},${a})`; }
    return color;
  }
  function seeded(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return () => { h += 0x6D2B79F5; let t = Math.imul(h ^ (h >>> 15), 1 | h); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function relTime(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return 'never';
    const s = (Date.now() - d.getTime()) / 1000;
    if (s < 45) return 'just now';
    if (s < 3600) return Math.round(s / 60) + 'm ago';
    if (s < 86400) return Math.round(s / 3600) + 'h ago';
    return Math.round(s / 86400) + 'd ago';
  }
  function ageSeconds(iso) { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? (Date.now() - d.getTime()) / 1000 : Infinity; }
  const easeOut = t => 1 - Math.pow(1 - t, 3);

  // Small glyphs drawn inside nodes (in node-local units; r = node radius).
  function drawGlyph(ctx, type, x, y, r, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = Math.max(1, r * 0.18); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const s = r * 0.55;
    switch (type) {
      case 'task': // play triangle
        ctx.beginPath(); ctx.moveTo(-s * 0.55, -s * 0.8); ctx.lineTo(s * 0.85, 0); ctx.lineTo(-s * 0.55, s * 0.8); ctx.closePath(); ctx.fill(); break;
      case 'table': // grid
        ctx.beginPath();
        ctx.rect(-s, -s * 0.8, 2 * s, 1.6 * s);
        ctx.moveTo(-s, -s * 0.27); ctx.lineTo(s, -s * 0.27);
        ctx.moveTo(-s, s * 0.27); ctx.lineTo(s, s * 0.27);
        ctx.moveTo(-s * 0.33, -s * 0.8); ctx.lineTo(-s * 0.33, s * 0.8);
        ctx.moveTo(s * 0.33, -s * 0.8); ctx.lineTo(s * 0.33, s * 0.8);
        ctx.stroke(); break;
      case 'file': // page with folded corner
        ctx.beginPath(); ctx.moveTo(-s * 0.7, -s); ctx.lineTo(s * 0.3, -s); ctx.lineTo(s * 0.7, -s * 0.6); ctx.lineTo(s * 0.7, s); ctx.lineTo(-s * 0.7, s); ctx.closePath(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(s * 0.3, -s); ctx.lineTo(s * 0.3, -s * 0.6); ctx.lineTo(s * 0.7, -s * 0.6); ctx.stroke(); break;
      case 'api': // cloud-ish: three arcs
        ctx.beginPath(); ctx.arc(-s * 0.35, s * 0.1, s * 0.5, Math.PI * 0.5, Math.PI * 1.5); ctx.arc(s * 0.05, -s * 0.25, s * 0.55, Math.PI * 1.1, Math.PI * 1.95); ctx.arc(s * 0.45, s * 0.1, s * 0.5, Math.PI * 1.5, Math.PI * 0.5); ctx.closePath(); ctx.stroke(); break;
      default: // dot
        ctx.beginPath(); ctx.arc(0, 0, s * 0.45, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }

  // ---------------------------------------------------------------- the map
  class AccessMap {
    constructor(section, api, mini) {
      this.section = section;
      this.api = api || {};
      this.mini = !!mini;
      this.host = mini ? section : section.querySelector('.map-host');
      this.canvas = this.host.querySelector('canvas');
      this.ctx = this.canvas.getContext('2d');
      this.tip = this.host.querySelector('.map-tip');
      this.detail = this.host.querySelector('.map-detail');
      this.menu = this.host.querySelector('.map-menu');
      this.overlay = this.host.querySelector('.map-overlay');
      this.legend = mini ? null : section.querySelector('.map-legend');
      this.toolbar = mini ? null : section.querySelector('.map-toolbar');

      this.nodes = new Map();
      this.edges = [];
      this.hidden = new Set();
      this.focus = null;
      this.hover = null;
      this.search = '';
      this.layout = 'force';
      this.labels = 'auto';
      this.opts = { ambient: true, halos: true, glyphs: true, minimap: true, starfield: false };
      this.view = { scale: 1, tx: 0, ty: 0 };
      this.settleUntil = 0;
      this.tweenUntil = 0;
      this.replays = [];
      this.replayQueue = [];
      this.raf = 0;
      this.drag = null;
      this.W = 0; this.H = 0; this.dpr = 1;
      this.firstLayout = true;
      this.userAdjusted = false;
      this.recentRuns = [];
      this.stars = null;
      this.lineage = null;

      const saved = (this.api.getState && this.api.getState()) || null;
      if (saved && saved.hidden) this.hidden = new Set(saved.hidden);
      if (saved && saved.view && typeof saved.view.scale === 'number') { this.view = saved.view; this.userAdjusted = !!saved.userAdjusted; }
      if (saved && saved.focus) this.focus = saved.focus;

      this.resize();
      this.fitTimer = 0;
      this.ro = new ResizeObserver(() => {
        const before = this.W * this.H;
        this.resize();
        const after = this.W * this.H;
        this.requestFrame();
        if (!this.nodes.size || before <= 0 || Math.abs(after - before) / before < 0.05) return;
        clearTimeout(this.fitTimer);
        this.fitTimer = setTimeout(() => {
          if (this.layout === 'radial') this.applyRadial(false);
          if (!this.userAdjusted) this.fit(true);
          else this.ensureVisible();
        }, 180);
      });
      this.ro.observe(this.host);
      // Coming back from hidden: any frame requested while hidden may be gone, so ask again.
      document.addEventListener('visibilitychange', () => { if (!document.hidden) { this.raf = 0; this.requestFrame(); if (performance.now() < this.settleUntil) this.ensureLoop(); } });
      if (!mini) { this.bind(); this.bindToolbar(); }
      else this.host.addEventListener('click', () => this.api.post && this.api.post({ type: 'openMap' }));
    }

    // ---------------------------------------------------------------- data in
    update(graph, options) {
      options = options || {};
      const prevLayout = this.layout;
      if (options.layout) this.layout = options.layout;
      if (options.labels) this.labels = options.labels;
      for (const k of ['ambient', 'halos', 'glyphs', 'minimap', 'starfield']) if (typeof options[k] === 'boolean') this.opts[k] = options[k];
      if (Array.isArray(options.recentRuns)) this.recentRuns = options.recentRuns;
      if (this.toolbar) {
        const l = this.toolbar.querySelector('.map-layout'); if (l && options.layout) l.value = options.layout;
        const w = this.toolbar.querySelector('.map-window'); if (w && typeof options.timeWindowDays === 'number') w.value = String([0, 1, 7, 30].includes(options.timeWindowDays) ? options.timeWindowDays : 0);
        const lb = this.toolbar.querySelector('.map-labels'); if (lb && options.labels) lb.value = options.labels;
        const rp = this.toolbar.querySelector('.map-replay'); if (rp) rp.disabled = !this.recentRuns.length;
      }
      const seen = new Set();
      const now = performance.now();
      const cx = this.W / 2, cy = this.H / 2;
      const R = Math.min(this.W, this.H) * 0.34 || 120;
      const hadNodes = this.nodes.size > 0;
      let changed = false;                       // did the set of nodes or links actually change?
      for (const n of graph.nodes) {
        seen.add(n.id);
        let node = this.nodes.get(n.id);
        if (!node) {
          changed = true;
          const rnd = seeded(n.id);
          const a = rnd() * Math.PI * 2;
          const r = (n.type === 'task' ? 0.35 : 1) * R * (0.6 + rnd() * 0.6);
          node = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, vx: 0, vy: 0, pinned: false, born: hadNodes && !reducedMotion ? now : 0 };
          this.nodes.set(n.id, node);
        }
        Object.assign(node, n);
      }
      for (const id of Array.from(this.nodes.keys())) if (!seen.has(id)) { this.nodes.delete(id); changed = true; }
      const edgeKey = graph.edges.map(e => `${e.from}>${e.to}`).sort().join('|');
      if (edgeKey !== this.edgeKey) { changed = changed || this.edgeKey !== undefined; this.edgeKey = edgeKey; }
      // A resource that just turned live was touched by the running script a moment ago: flash it.
      const nowLive = new Set(graph.nodes.filter(n => n.live && n.type !== 'task').map(n => n.id));
      if (this.prevLive) for (const id of nowLive) if (!this.prevLive.has(id)) { const n = this.nodes.get(id); if (n) n.touched = performance.now(); }
      this.prevLive = nowLive;
      this.edges = graph.edges.filter(e => this.nodes.has(e.from) && this.nodes.has(e.to));
      this.activeTasks = graph.activeTasks || [];
      this.dropped = graph.dropped || 0;
      if (this.focus && !this.nodes.has(this.focus)) { this.focus = null; this.hideDetail(); }
      this.lineage = this.focus ? this.computeLineage(this.focus) : null;
      this.buildLegend();
      // Re-run the physics only when the graph's shape changed (or on first draw / a layout
      // switch). A refresh that merely updates counts and live flags must not nudge the nodes —
      // an idle map has to stay perfectly still, and a jitter every refresh would read as activity.
      if (this.layout === 'radial') { if (prevLayout !== 'radial' || this.firstLayout || changed) this.applyRadial(prevLayout !== 'radial' || this.firstLayout); }
      else if (this.firstLayout || changed || prevLayout === 'radial') this.settle();
      if (this.firstLayout) { if (!this.userAdjusted) this.fit(true); else this.ensureVisible(); }
      this.firstLayout = false;
      if (this.focus) this.showDetail(this.focus);
      this.requestFrame();
    }

    replay(rp) {
      if (!rp || !rp.accessed || reducedMotion) return;
      const from = 'task:' + rp.task;
      if (!this.nodes.has(from)) return;
      const ids = rp.accessed.filter(id => this.nodes.has(id));
      if (!ids.length) return;
      const t0 = performance.now();
      ids.forEach((to, i) => this.replays.push({ from, to, start: t0 + i * 220, dur: 900 }));
      this.showOverlay(`${rp.task} · ${ids.length} touched`, 1400 + ids.length * 220);
      this.requestFrame();
    }

    /** Replay the recent runs one after another (toolbar button). */
    replayRecent() {
      if (!this.recentRuns.length || reducedMotion) return;
      const runs = this.recentRuns.slice(0, 5).reverse(); // oldest first
      let i = 0;
      const step = () => {
        if (i >= runs.length) { this.showOverlay('replay done', 900); return; }
        const r = runs[i++];
        const ids = (r.accessed || []).filter(id => this.nodes.has(id));
        const from = 'task:' + r.task;
        if (this.nodes.has(from) && ids.length) {
          const t0 = performance.now();
          ids.forEach((to, k) => this.replays.push({ from, to, start: t0 + k * 200, dur: 800 }));
          this.showOverlay(`${i}/${runs.length} · ${r.task} · ${relTime(r.date)}`, 900 + ids.length * 200);
          this.requestFrame();
        }
        this.replayTimer = setTimeout(step, 900 + ids.length * 200);
      };
      clearTimeout(this.replayTimer);
      step();
    }

    showOverlay(text, ms) {
      if (!this.overlay) return;
      this.overlay.textContent = text;
      this.overlay.hidden = false;
      clearTimeout(this.overlayTimer);
      this.overlayTimer = setTimeout(() => { this.overlay.hidden = true; }, ms);
    }

    // ---------------------------------------------------------------- lineage
    /** Writers → this node → readers, plus one more hop each way; used for focus highlighting. */
    computeLineage(id) {
      const n = this.nodes.get(id);
      if (!n) return null;
      const up = new Set(), down = new Set(), up2 = new Set(), down2 = new Set();
      const edgesIn = this.edges.filter(e => e.to === id), edgesOut = this.edges.filter(e => e.from === id);
      if (n.type === 'task') {
        // A script: what it reads is upstream, what it writes is downstream.
        for (const e of edgesOut) (e.mode === 'write' ? down : up).add(e.to);
        for (const r of down) for (const e of this.edges) if (e.to === r && e.mode === 'read' && e.from !== id) down2.add(e.from);
        for (const r of up) for (const e of this.edges) if (e.to === r && e.mode === 'write' && e.from !== id) up2.add(e.from);
      } else {
        // A resource: scripts that write it are upstream, scripts that read it are downstream.
        for (const e of edgesIn) (e.mode === 'write' ? up : down).add(e.from);
        for (const t of down) for (const e of this.edges) if (e.from === t && e.mode === 'write' && e.to !== id) down2.add(e.to);
        for (const t of up) for (const e of this.edges) if (e.from === t && e.mode === 'read' && e.to !== id) up2.add(e.to);
      }
      const all = new Set([id, ...up, ...down, ...up2, ...down2]);
      return { id, up, down, up2, down2, all };
    }

    // ---------------------------------------------------------------- layouts
    settle() {
      if (reducedMotion) { for (let i = 0; i < 300; i++) this.step(1); this.settleUntil = 0; }
      else this.settleUntil = performance.now() + 2600;
      this.requestFrame();
      this.ensureLoop();
    }
    /**
     * requestAnimationFrame does not fire while a webview is hidden or was created in the
     * background, and a frame requested then can be dropped for good — measured: the map's first
     * frame never came and the graph sat in its initial scatter until something else woke it.
     * This watchdog steps the physics itself whenever frames stop arriving during a settle, and
     * re-arms the loop, so the layout always finishes (and the fit runs on finished positions).
     */
    ensureLoop() {
      if (this.watchdog) return;
      this.watchdog = setInterval(() => {
        const now = performance.now();
        const stalled = now - (this.lastFrame || 0) > 250;
        if (stalled) {
          this.raf = 0; this.requestFrame();
          if (now < this.settleUntil) { this.step(1); this.step(1); this.lastDraw = now; }
        }
        if (now > this.settleUntil + 400 && !this.edges.some(e => e.live)) { clearInterval(this.watchdog); this.watchdog = 0; }
      }, 120);
    }

    applyRadial(animate) {
      const visible = Array.from(this.nodes.values()).filter(n => !this.hidden.has(n.type));
      const tasks = visible.filter(n => n.type === 'task').sort((a, b) => (a.label || '').localeCompare(b.label || ''));
      const res = visible.filter(n => n.type !== 'task');
      const cx = this.W / 2, cy = this.H / 2;
      const base = Math.min(this.W, this.H) / 2;
      const r1 = tasks.length === 1 ? 0 : Math.min(base * 0.28, 40 + tasks.length * 14);
      const r2 = Math.max(base * 0.62, r1 + 120);
      tasks.forEach((n, i) => {
        const a = -Math.PI / 2 + (i / Math.max(1, tasks.length)) * Math.PI * 2;
        n.tx = cx + Math.cos(a) * r1; n.ty = cy + Math.sin(a) * r1;
      });
      const groups = TYPE_ORDER.filter(t => t !== 'task').map(t => res.filter(n => n.type === t).sort((a, b) => (a.label || '').localeCompare(b.label || ''))).filter(g => g.length);
      const total = res.length || 1;
      let angle = -Math.PI / 2;
      const gap = groups.length > 1 ? 0.12 : 0;
      for (const g of groups) {
        const span = (g.length / total) * (Math.PI * 2 - gap * groups.length);
        g.forEach((n, i) => {
          const a = angle + gap / 2 + ((i + 0.5) / g.length) * span;
          n.tx = cx + Math.cos(a) * r2; n.ty = cy + Math.sin(a) * r2;
        });
        angle += span + gap;
      }
      for (const n of visible) { n.pinned = true; n.vx = 0; n.vy = 0; n.fx = n.x; n.fy = n.y; }
      this.settleUntil = 0;
      if (animate && !reducedMotion) this.tweenUntil = performance.now() + 700;
      else { for (const n of visible) { n.x = n.tx; n.y = n.ty; } this.tweenUntil = 0; }
      this.requestFrame();
    }

    step(dt) {
      const nodes = Array.from(this.nodes.values()).filter(n => !this.hidden.has(n.type));
      const cx = this.W / 2, cy = this.H / 2;
      const k = 2600;
      // Gravity is weaker along the longer axis, so a wide tab gets a wide constellation
      // instead of a square blob in the middle with empty space either side.
      const ax = Math.min(1, this.H / this.W), ay = Math.min(1, this.W / this.H);
      // Springs rest longer on a bigger canvas; the fit handles the rest.
      const restBase = Math.max(100, Math.min(200, Math.sqrt(this.W * this.H) / 6));
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        const g = a.type === 'task' ? 0.03 : 0.012;
        a.vx += (cx - a.x) * g * ax * dt; a.vy += (cy - a.y) * g * ay * dt;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = 0.5; dy = 0.5; d2 = 0.5; }
          const d = Math.sqrt(d2);
          const boost = (a.type === 'task' && b.type === 'task') ? 14 : (a.type === 'task' || b.type === 'task') ? 1.8 : 1;
          const f = Math.min(k * boost / d2, boost > 5 ? 16 : 9) * dt;
          const fx = (dx / d) * f, fy = (dy / d) * f;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
      }
      for (const e of this.edges) {
        const a = this.nodes.get(e.from), b = this.nodes.get(e.to);
        if (!a || !b || this.hidden.has(a.type) || this.hidden.has(b.type)) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const rest = restBase + Math.min(70, (a.degree + b.degree) * 4);
        const f = (d - rest) * 0.02 * dt;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
      for (const n of nodes) {
        if (n.pinned) { n.vx = 0; n.vy = 0; continue; }
        n.vx *= 0.82; n.vy *= 0.82; n.x += n.vx; n.y += n.vy;
      }
    }

    // ---------------------------------------------------------------- view
    resize() {
      const rect = this.host.getBoundingClientRect();
      this.dpr = window.devicePixelRatio || 1;
      this.W = Math.max(50, rect.width); this.H = Math.max(50, rect.height);
      this.canvas.width = Math.round(this.W * this.dpr); this.canvas.height = Math.round(this.H * this.dpr);
    }
    toScreen(x, y) { return [x * this.view.scale + this.view.tx, y * this.view.scale + this.view.ty]; }
    toWorld(sx, sy) { return [(sx - this.view.tx) / this.view.scale, (sy - this.view.ty) / this.view.scale]; }
    bbox() {
      const nodes = Array.from(this.nodes.values()).filter(n => !this.hidden.has(n.type));
      if (!nodes.length) return null;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        const x = this.layout === 'radial' && n.tx !== undefined ? n.tx : n.x, y = this.layout === 'radial' && n.ty !== undefined ? n.ty : n.y;
        minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      }
      return { minX, minY, maxX, maxY };
    }
    fit(instant) {
      const b = this.bbox();
      if (!b) { this.view = { scale: 1, tx: 0, ty: 0 }; return; }
      const pad = this.mini ? 24 : 56;
      // Labels hang to the right of their node in screen pixels, so the widest one on the
      // right-hand side needs room after scaling; two passes get the scale and the margin to agree.
      let scale = 1, extra = 0;
      for (let pass = 0; pass < 2; pass++) {
        extra = 0;
        if (!this.mini) {
          for (const n of this.nodes.values()) {
            if (this.hidden.has(n.type)) continue;
            const x = this.layout === 'radial' && n.tx !== undefined ? n.tx : n.x;
            const px = 14 + truncate(n.label || n.id, 36).length * 6.4;     // approx label width on screen
            extra = Math.max(extra, (x - b.minX) + px / scale - (b.maxX - b.minX));
          }
        }
        const w = Math.max(60, b.maxX - b.minX + Math.max(0, extra) + pad * 2), h = Math.max(60, b.maxY - b.minY + pad * 2);
        scale = Math.max(0.25, Math.min(1.6, Math.min(this.W / w, this.H / h)));
      }
      const cxW = (b.minX + b.maxX + Math.max(0, extra)) / 2;
      const target = { scale, tx: this.W / 2 - cxW * scale, ty: this.H / 2 - ((b.minY + b.maxY) / 2) * scale };
      if (instant || reducedMotion) { this.view = target; this.viewTween = 0; }
      else { this.viewFrom = { ...this.view }; this.viewTo = target; this.viewTween = performance.now() + 450; }
      this.persist();
      this.requestFrame();
    }
    /** If most of the graph is outside the viewport (a stale saved view, a resize), refit. */
    ensureVisible() {
      const b = this.bbox();
      if (!b) return;
      const [x0, y0] = this.toScreen(b.minX, b.minY), [x1, y1] = this.toScreen(b.maxX, b.maxY);
      const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      // "Visible" means the centre is on screen AND most nodes are: a centre just inside the
      // edge with the rest hanging off it is exactly what the user had to drag back into view.
      let onScreen = 0, total = 0;
      for (const n of this.nodes.values()) {
        if (this.hidden.has(n.type)) continue;
        total++;
        const [sx, sy] = this.toScreen(n.x, n.y);
        if (sx > 0 && sx < this.W && sy > 0 && sy < this.H) onScreen++;
      }
      const inside = cx > 0 && cx < this.W && cy > 0 && cy < this.H && (total === 0 || onScreen / total >= 0.7);
      const tooSmall = (x1 - x0) < this.W * 0.15 && (y1 - y0) < this.H * 0.15 && this.nodes.size > 1;
      const tooBig = (x1 - x0) > this.W * 3 || (y1 - y0) > this.H * 3;
      if (!inside || tooSmall || tooBig) { this.userAdjusted = false; this.fit(true); }
    }
    persist() {
      if (this.api.setState) this.api.setState({ view: this.view, hidden: Array.from(this.hidden), focus: this.focus, userAdjusted: this.userAdjusted });
    }

    // ---------------------------------------------------------------- drawing
    requestFrame() { if (!this.raf) this.raf = requestAnimationFrame(t => this.frame(t)); }
    frame(t) {
      this.raf = 0;
      this.lastFrame = t;
      let animating = false;
      if (t < this.settleUntil) {
        this.step(1); animating = true; this.wasSettling = true;
        // The camera follows the layout while it settles, so the graph is never off-screen
        // between the first scatter and the final arrangement (unless the user took the wheel).
        if (!this.userAdjusted && !this.viewTween) this.fit(true);
      }
      else if (this.wasSettling) { this.wasSettling = false; if (!this.userAdjusted) this.fit(true); else this.ensureVisible(); }
      if (this.tweenUntil && t < this.tweenUntil) {
        const k = easeOut(1 - (this.tweenUntil - t) / 700);
        for (const n of this.nodes.values()) if (n.tx !== undefined) { n.x = n.fx + (n.tx - n.fx) * k; n.y = n.fy + (n.ty - n.fy) * k; }
        animating = true;
      } else if (this.tweenUntil) { for (const n of this.nodes.values()) if (n.tx !== undefined) { n.x = n.tx; n.y = n.ty; } this.tweenUntil = 0; }
      if (this.viewTween && t < this.viewTween) {
        const k = easeOut(1 - (this.viewTween - t) / 450);
        this.view = { scale: this.viewFrom.scale + (this.viewTo.scale - this.viewFrom.scale) * k, tx: this.viewFrom.tx + (this.viewTo.tx - this.viewFrom.tx) * k, ty: this.viewFrom.ty + (this.viewTo.ty - this.viewFrom.ty) * k };
        animating = true;
      } else if (this.viewTween) { this.view = this.viewTo; this.viewTween = 0; }
      this.draw(t);
      const live = !reducedMotion && !this.mini && !document.hidden && (this.edges.some(e => e.live) || this.replays.length || Array.from(this.nodes.values()).some(n => (n.born && t - n.born < 2000) || (n.touched && t - n.touched < 1800)));
      if (animating || live) this.requestFrame();
    }

    draw(t) {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
      const fg = css('--vscode-foreground', '#ccc');
      const bg = css('--vscode-editor-background', '#1e1e1e');
      const font = css('--vscode-font-family', 'sans-serif');
      const upColor = css('--vscode-charts-orange', '#d18616');
      const downColor = css('--vscode-charts-green', '#89d185');
      const color = type => css(TYPE_VAR[type] || TYPE_VAR.other, FALLBACK[type] || FALLBACK.other);
      const s = this.view.scale;
      const lin = this.lineage;
      const q = this.search;
      const matches = q ? new Set(Array.from(this.nodes.values()).filter(n => (n.label || n.id).toLowerCase().includes(q)).map(n => n.id)) : null;
      const isDim = id => (lin && !lin.all.has(id)) || (matches && !matches.has(id));
      const hoverSet = this.hover ? this.neighbourSet(this.hover) : null;
      const pulse = 0.5 + 0.5 * Math.sin(t / 240);
      const many = this.nodes.size > 40;

      if (this.opts.starfield && !this.mini) this.drawStars(t, fg);

      ctx.save();
      ctx.translate(this.view.tx, this.view.ty);
      ctx.scale(s, s);

      // Halos behind script hubs (and type clusters in radial mode).
      if (this.opts.halos && !this.mini) {
        for (const n of this.nodes.values()) {
          if (n.type !== 'task' || this.hidden.has(n.type)) continue;
          const r = 60 + Math.min(60, n.degree * 6);
          const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r);
          const c = color('task');
          g.addColorStop(0, withAlpha(c, isDim(n.id) ? 0.03 : 0.10));
          g.addColorStop(1, withAlpha(c, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
        }
        if (this.layout === 'radial') {
          for (const type of TYPE_ORDER) {
            if (type === 'task' || this.hidden.has(type)) continue;
            const group = Array.from(this.nodes.values()).filter(n => n.type === type);
            if (group.length < 2) continue;
            const cx = group.reduce((a, n) => a + n.x, 0) / group.length, cy = group.reduce((a, n) => a + n.y, 0) / group.length;
            const rad = Math.max(...group.map(n => Math.hypot(n.x - cx, n.y - cy))) + 50;
            const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
            g.addColorStop(0, withAlpha(color(type), 0.07)); g.addColorStop(1, withAlpha(color(type), 0));
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2); ctx.fill();
          }
        }
      }

      // Edges.
      for (const e of this.edges) {
        const a = this.nodes.get(e.from), b = this.nodes.get(e.to);
        if (!a || !b || this.hidden.has(a.type) || this.hidden.has(b.type)) continue;
        const dim = isDim(e.from) || isDim(e.to);
        const hot = hoverSet && (e.from === this.hover || e.to === this.hover);
        const width = (0.8 + Math.min(4, Math.log2(1 + (e.count || 1)))) / Math.sqrt(s);
        const [mx, my] = this.ctrl(a, b);
        let stroke = fg, alpha = dim ? 0.05 : hot ? 0.85 : e.mode === 'write' ? 0.38 : 0.22, lw = hot ? width + 0.6 : width;
        if (lin && !dim) {
          // Lineage colouring: upstream in orange, downstream in green.
          const other = e.from === lin.id ? e.to : e.to === lin.id ? e.from : null;
          const upSide = lin.up.has(e.from) || lin.up.has(e.to) || lin.up2.has(e.from) || lin.up2.has(e.to);
          const downSide = lin.down.has(e.from) || lin.down.has(e.to) || lin.down2.has(e.from) || lin.down2.has(e.to);
          if (other !== null || upSide || downSide) {
            const isUp = other !== null ? (lin.up.has(other)) : upSide && !downSide;
            stroke = isUp ? upColor : downColor; alpha = 0.85; lw = width + 0.8;
          }
        }
        if (e.live) { stroke = color('task'); alpha = dim ? 0.12 : 0.5 + 0.4 * pulse; lw = width + 1; }
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx, my, b.x, b.y);
        ctx.strokeStyle = stroke; ctx.globalAlpha = alpha; ctx.lineWidth = lw;
        ctx.setLineDash(e.mode === 'write' ? [] : [5 / s, 4 / s]);
        ctx.stroke();
        ctx.setLineDash([]);
        if (e.mode === 'write' && !dim && s > 0.6) {
          const ang = Math.atan2(b.y - my, b.x - mx);
          const rb = this.radius(b) + 2;
          const px = b.x - Math.cos(ang) * rb, py = b.y - Math.sin(ang) * rb;
          ctx.beginPath(); ctx.moveTo(px, py);
          ctx.lineTo(px - Math.cos(ang - 0.5) * 6 / s, py - Math.sin(ang - 0.5) * 6 / s);
          ctx.lineTo(px - Math.cos(ang + 0.5) * 6 / s, py - Math.sin(ang + 0.5) * 6 / s);
          ctx.closePath(); ctx.fillStyle = stroke; ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // Traffic particles: ONLY on links a running script has actually used this run (e.live),
      // flowing script→resource for writes and resource→script for reads. Nothing moves on an
      // idle map — motion here means activity, never decoration. Replay pulses are the
      // exception and only ever follow a real, just-finished run.
      if (!reducedMotion && !this.mini && this.opts.ambient) {
        for (const e of this.edges) {
          if (!e.live) continue;
          const a = this.nodes.get(e.from), b = this.nodes.get(e.to);
          if (!a || !b || this.hidden.has(a.type) || this.hidden.has(b.type)) continue;
          const dim = isDim(e.from) || isDim(e.to);
          const [mx, my] = this.ctrl(a, b);
          const count = 2 + Math.min(2, Math.floor(Math.log2(1 + (e.count || 1)) / 2));
          const period = 1400;
          for (let i = 0; i < count; i++) {
            const k = ((t / period) + i / count + (e.count || 1) * 0.13) % 1;
            const [px, py] = this.bez(a, mx, my, b, e.mode === 'write' ? k : 1 - k);
            ctx.beginPath(); ctx.arc(px, py, 2.4 / Math.sqrt(s), 0, Math.PI * 2);
            ctx.fillStyle = color('task'); ctx.globalAlpha = dim ? 0.3 : 0.9; ctx.fill();
          }
        }
      }
      if (!reducedMotion && !this.mini) {
        this.replays = this.replays.filter(r => t < r.start + r.dur);
        for (const r of this.replays) {
          if (t < r.start) continue;
          const a = this.nodes.get(r.from), b = this.nodes.get(r.to);
          if (!a || !b) continue;
          const k = easeOut((t - r.start) / r.dur);
          const [mx, my] = this.ctrl(a, b);
          const [px, py] = this.bez(a, mx, my, b, k);
          ctx.beginPath(); ctx.arc(px, py, 3.5 / Math.sqrt(s), 0, Math.PI * 2);
          ctx.fillStyle = color(b.type); ctx.globalAlpha = 1 - k * 0.5; ctx.fill();
          if (k > 0.9) { ctx.beginPath(); ctx.arc(b.x, b.y, this.radius(b) + 6 * (k - 0.9) * 10, 0, Math.PI * 2); ctx.strokeStyle = color(b.type); ctx.globalAlpha = (1 - k) * 4; ctx.lineWidth = 1.5 / s; ctx.stroke(); }
        }
        ctx.globalAlpha = 1;
      }

      // Nodes.
      ctx.textBaseline = 'middle';
      const drawn = Array.from(this.nodes.values()).filter(n => !this.hidden.has(n.type));
      for (const n of this.nodes.values()) {
        if (this.hidden.has(n.type)) continue;
        const dim = isDim(n.id);
        const c = color(n.type);
        const r = this.radius(n);
        const warm = Math.round(Math.max(0, 1 - ageSeconds(n.lastSeen) / 900) * 12) / 12; // touched in the last 15 min glows warmer (stepped, so an idle redraw is pixel-identical)
        ctx.globalAlpha = dim ? 0.18 : 1;
        if (!this.mini) {
          const g = ctx.createRadialGradient(n.x, n.y, r * 0.5, n.x, n.y, r * (3.2 + warm * 1.5));
          g.addColorStop(0, withAlpha(c, n.live ? 0.4 : 0.14 + warm * 0.2)); g.addColorStop(1, withAlpha(c, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(n.x, n.y, r * (3.2 + warm * 1.5), 0, Math.PI * 2); ctx.fill();
        }
        if (n.live && !reducedMotion) {
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 3 + pulse * 6, 0, Math.PI * 2);
          ctx.strokeStyle = c; ctx.globalAlpha = (dim ? 0.05 : 0.5) * (1 - pulse); ctx.lineWidth = 1.5 / s; ctx.stroke();
          ctx.globalAlpha = dim ? 0.18 : 1;
        }
        if (n.touched && t - n.touched < 1800) {
          const k = (t - n.touched) / 1800;
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 2 + k * 26, 0, Math.PI * 2);
          ctx.strokeStyle = color('task'); ctx.globalAlpha = (1 - k) * 0.9; ctx.lineWidth = 2 / s; ctx.stroke();
          ctx.globalAlpha = dim ? 0.18 : 1;
        }
        if (n.born && t - n.born < 2000) {
          const k = (t - n.born) / 2000;
          ctx.beginPath(); ctx.arc(n.x, n.y, r + k * 34, 0, Math.PI * 2);
          ctx.strokeStyle = c; ctx.globalAlpha = (1 - k) * 0.8; ctx.lineWidth = 1.2 / s; ctx.stroke();
          ctx.globalAlpha = dim ? 0.18 : 1;
        }
        // Lineage ring: upstream orange, downstream green.
        if (lin && n.id !== lin.id && !dim) {
          const isUp = lin.up.has(n.id) || lin.up2.has(n.id);
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 4 / s, 0, Math.PI * 2);
          ctx.strokeStyle = isUp ? upColor : downColor; ctx.lineWidth = (lin.up.has(n.id) || lin.down.has(n.id) ? 2 : 1) / s; ctx.globalAlpha = 0.9; ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = c; ctx.fill();
        if (this.opts.glyphs && !this.mini && r >= 5) drawGlyph(ctx, n.type, n.x, n.y, r, withAlpha(bg, 0.9));
        else if (n.type === 'task') { ctx.beginPath(); ctx.arc(n.x, n.y, r * 0.45, 0, Math.PI * 2); ctx.fillStyle = bg; ctx.globalAlpha = dim ? 0.1 : 0.85; ctx.fill(); ctx.globalAlpha = dim ? 0.18 : 1; }
        if (n.id === this.focus || n.id === this.hover || (this.activeTasks || []).includes(n.id) || (n.pinned && this.layout === 'force')) {
          ctx.lineWidth = (n.id === this.focus ? 2.2 : 1.4) / s;
          ctx.strokeStyle = n.pinned && this.layout === 'force' && n.id !== this.focus && n.id !== this.hover ? withAlpha(fg, 0.5) : fg;
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 1.5 / s, 0, Math.PI * 2); ctx.stroke();
        }
        const show = this.labels === 'all' || n.type === 'task' || (this.labels === 'auto' && (!many || n.id === this.hover || n.id === this.focus || (lin && lin.all.has(n.id)) || (matches && matches.has(n.id)))) || (this.mini && n.type === 'task');
        if (show && !dim && !(this.mini && n.type !== 'task')) {
          const size = (n.type === 'task' ? 12 : 11) / Math.max(0.75, Math.sqrt(s));
          ctx.font = `${n.type === 'task' ? '600 ' : ''}${size}px ${font}`;
          ctx.textAlign = 'left';
          const label = truncate(n.label || n.id, this.mini ? 18 : 36);
          // Put the label on whichever side has more room: a neighbour sitting just to the
          // right, at about the same height, would otherwise print straight through the text.
          const width = ctx.measureText(label).width;
          const crowded = (side) => {
            let worst = 0;
            for (const o of drawn) {
              if (o === n) continue;
              const dy = Math.abs(o.y - n.y) * s;
              if (dy > 16) continue;
              const dx = (o.x - n.x) * s * side;
              if (dx > 0 && dx < width * s + 24) worst = Math.max(worst, 1 - dx / (width * s + 24));
            }
            return worst;
          };
          const left = !this.mini && crowded(1) > crowded(-1) + 0.05;
          ctx.textAlign = left ? 'right' : 'left';
          const lx = left ? n.x - r - 5 / s : n.x + r + 5 / s, ly = n.y;
          ctx.lineWidth = 3 / s; ctx.strokeStyle = withAlpha(bg, 0.85); ctx.lineJoin = 'round';
          ctx.strokeText(label, lx, ly);
          ctx.fillStyle = fg; ctx.fillText(label, lx, ly);
        }
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      if (this.nodes.size === 0) {
        ctx.fillStyle = css('--vscode-descriptionForeground', '#999'); ctx.font = `12px ${font}`; ctx.textAlign = 'center';
        ctx.fillText('No access data yet', this.W / 2, this.H / 2);
      } else if (!this.mini) {
        ctx.fillStyle = css('--vscode-descriptionForeground', '#999'); ctx.font = `10px ${font}`; ctx.textAlign = 'right';
        const visible = Array.from(this.nodes.values()).filter(n => !this.hidden.has(n.type)).length;
        ctx.fillText(`${visible} nodes · ${this.edges.length} links · ${Math.round(s * 100)}%${this.dropped ? ` · +${this.dropped} hidden` : ''}${lin ? ' · lineage' : ''}`, this.W - 8, this.H - 10);
        if (this.opts.minimap) this.drawMinimap(fg, bg, color);
      }
    }

    drawStars(t, fg) {
      const ctx = this.ctx;
      if (!this.stars || this.stars.w !== this.W || this.stars.h !== this.H) {
        const rnd = seeded('stars');
        this.stars = { w: this.W, h: this.H, pts: Array.from({ length: Math.round(this.W * this.H / 9000) }, () => ({ x: rnd() * this.W, y: rnd() * this.H, r: 0.4 + rnd() * 1.1, p: rnd() * Math.PI * 2, v: 0.02 + rnd() * 0.05 })) };
      }
      // Static on purpose: the backdrop never twinkles or drifts, so any motion on the map is activity.
      ctx.save();
      for (const st of this.stars.pts) {
        ctx.globalAlpha = (0.35 + 0.35 * Math.sin(st.p)) * 0.5;
        ctx.fillStyle = fg;
        ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    }

    drawMinimap(fg, bg, color) {
      const b = this.bbox();
      if (!b) return;
      const [x0, y0] = this.toScreen(b.minX, b.minY), [x1, y1] = this.toScreen(b.maxX, b.maxY);
      const graphFits = x0 >= 0 && y0 >= 0 && x1 <= this.W && y1 <= this.H;
      if (graphFits) { this.miniRect = null; return; }
      const ctx = this.ctx;
      const mw = 150, mh = 100, pad = 10;
      const ox = this.W - mw - pad, oy = this.H - mh - pad - 14;
      const gw = Math.max(1, b.maxX - b.minX), gh = Math.max(1, b.maxY - b.minY);
      const k = Math.min((mw - 16) / gw, (mh - 16) / gh);
      const gx = ox + (mw - gw * k) / 2 - b.minX * k, gy = oy + (mh - gh * k) / 2 - b.minY * k;
      ctx.save();
      ctx.globalAlpha = 0.92;
      ctx.fillStyle = withAlpha(bg, 0.85); ctx.strokeStyle = withAlpha(fg, 0.35); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.rect(ox, oy, mw, mh); ctx.fill(); ctx.stroke();
      for (const n of this.nodes.values()) {
        if (this.hidden.has(n.type)) continue;
        ctx.fillStyle = color(n.type); ctx.beginPath(); ctx.arc(gx + n.x * k, gy + n.y * k, n.type === 'task' ? 2.2 : 1.4, 0, Math.PI * 2); ctx.fill();
      }
      // viewport rectangle
      const [vx0, vy0] = this.toWorld(0, 0), [vx1, vy1] = this.toWorld(this.W, this.H);
      ctx.strokeStyle = withAlpha(fg, 0.8); ctx.lineWidth = 1;
      ctx.strokeRect(gx + vx0 * k, gy + vy0 * k, (vx1 - vx0) * k, (vy1 - vy0) * k);
      ctx.restore();
      this.miniRect = { ox, oy, mw, mh, gx, gy, k };
    }

    radius(n) { return (n.type === 'task' ? 8 : 4.5) + Math.min(7, Math.sqrt(n.degree || 0) * 1.5); }
    ctrl(a, b) {
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const sign = (a.id < b.id ? 1 : -1);
      const off = Math.min(28, d * 0.12) * sign;
      return [(a.x + b.x) / 2 - (dy / d) * off, (a.y + b.y) / 2 + (dx / d) * off];
    }
    bez(a, mx, my, b, k) { const u = 1 - k; return [u * u * a.x + 2 * u * k * mx + k * k * b.x, u * u * a.y + 2 * u * k * my + k * k * b.y]; }
    neighbourSet(id) {
      const s = new Set([id]);
      for (const e of this.edges) { if (e.from === id) s.add(e.to); if (e.to === id) s.add(e.from); }
      return s;
    }

    // ---------------------------------------------------------------- interaction
    bind() {
      const c = this.canvas;
      c.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        this.hideMenu();
        // Mini-map click: jump the viewport there.
        if (this.miniRect) {
          const rect = c.getBoundingClientRect(); const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
          const m = this.miniRect;
          if (sx >= m.ox && sx <= m.ox + m.mw && sy >= m.oy && sy <= m.oy + m.mh) {
            const wx = (sx - m.gx) / m.k, wy = (sy - m.gy) / m.k;
            this.view.tx = this.W / 2 - wx * this.view.scale; this.view.ty = this.H / 2 - wy * this.view.scale;
            this.userAdjusted = true; this.persist(); this.requestFrame(); return;
          }
        }
        const n = this.hit(e);
        this.drag = { node: n, sx: e.clientX, sy: e.clientY, vx: this.view.tx, vy: this.view.ty, moved: false, ox: n ? n.x : 0, oy: n ? n.y : 0 };
        c.setPointerCapture(e.pointerId);
        c.classList.add('grabbing');
      });
      c.addEventListener('pointermove', e => {
        if (this.drag) {
          const dx = e.clientX - this.drag.sx, dy = e.clientY - this.drag.sy;
          if (Math.abs(dx) + Math.abs(dy) > 3) this.drag.moved = true;
          if (this.drag.node) {
            const n = this.drag.node;
            n.x = this.drag.ox + dx / this.view.scale; n.y = this.drag.oy + dy / this.view.scale;
            n.pinned = true; n.vx = 0; n.vy = 0;
            if (this.layout === 'force' && !reducedMotion) this.settleUntil = performance.now() + 800;
          } else {
            this.view.tx = this.drag.vx + dx; this.view.ty = this.drag.vy + dy;
            this.userAdjusted = true;
          }
          this.showTip(null);
          this.requestFrame();
          return;
        }
        const n = this.hit(e);
        const id = n ? n.id : null;
        if (id !== this.hover) { this.hover = id; c.style.cursor = n ? 'pointer' : 'grab'; this.requestFrame(); }
        this.showTip(n, e);
      });
      const end = e => {
        if (!this.drag) return;
        const d = this.drag; this.drag = null;
        c.classList.remove('grabbing');
        if (!d.moved) {
          const n = this.hit(e);
          this.setFocus(n ? (this.focus === n.id ? null : n.id) : null);
        }
        this.persist();
        this.requestFrame();
      };
      c.addEventListener('pointerup', end);
      c.addEventListener('pointercancel', () => { this.drag = null; c.classList.remove('grabbing'); });
      c.addEventListener('mouseleave', () => { this.hover = null; this.showTip(null); this.requestFrame(); });
      c.addEventListener('dblclick', e => { e.preventDefault(); this.resetView(); });
      c.addEventListener('contextmenu', e => {
        e.preventDefault();
        const n = this.hit(e);
        if (n) this.showMenu(n, e); else this.hideMenu();
      });
      c.addEventListener('wheel', e => {
        e.preventDefault();
        const rect = c.getBoundingClientRect();
        const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
        const [wx, wy] = this.toWorld(sx, sy);
        const factor = Math.exp(-e.deltaY * 0.0015);
        const scale = Math.max(0.2, Math.min(4, this.view.scale * factor));
        this.view = { scale, tx: sx - wx * scale, ty: sy - wy * scale };
        this.userAdjusted = true;
        this.persist();
        this.requestFrame();
      }, { passive: false });
      c.addEventListener('keydown', e => {
        if (e.key === 'Escape') { this.setFocus(null); this.hideMenu(); this.requestFrame(); }
        else if (e.key === 'f' || e.key === 'F') { this.userAdjusted = false; this.fit(false); }
        else if (e.key === 'r' || e.key === 'R') this.relayoutAll();
        else if (e.key === '/') { e.preventDefault(); const inp = this.toolbar && this.toolbar.querySelector('.map-search'); if (inp) inp.focus(); }
        else if (e.key === '+' || e.key === '=') this.zoomBy(1.25);
        else if (e.key === '-' || e.key === '_') this.zoomBy(0.8);
        else return;
      });
      c.tabIndex = 0;
      document.addEventListener('visibilitychange', () => { if (!document.hidden) this.requestFrame(); });
    }

    zoomBy(f) {
      const [wx, wy] = this.toWorld(this.W / 2, this.H / 2);
      const scale = Math.max(0.2, Math.min(4, this.view.scale * f));
      this.view = { scale, tx: this.W / 2 - wx * scale, ty: this.H / 2 - wy * scale };
      this.userAdjusted = true; this.persist(); this.requestFrame();
    }
    resetView() {
      this.setFocus(null); this.search = '';
      const inp = this.toolbar && this.toolbar.querySelector('.map-search'); if (inp) inp.value = '';
      this.relayoutAll();
    }
    relayoutAll() {
      for (const n of this.nodes.values()) n.pinned = this.layout === 'radial';
      if (this.layout === 'radial') this.applyRadial(true); else { this.scatter(); this.settle(); }
      this.userAdjusted = false; this.fit(false);
    }
    setFocus(id) {
      this.focus = id;
      this.lineage = id ? this.computeLineage(id) : null;
      if (id) this.showDetail(id); else this.hideDetail();
      this.persist();
      this.requestFrame();
    }

    bindToolbar() {
      const tb = this.toolbar;
      if (!tb) return;
      const search = tb.querySelector('.map-search');
      if (search) {
        search.addEventListener('input', () => { this.search = search.value.trim().toLowerCase(); this.requestFrame(); });
        search.addEventListener('keydown', e => {
          if (e.key === 'Enter') {
            const first = Array.from(this.nodes.values()).find(n => this.search && (n.label || n.id).toLowerCase().includes(this.search) && !this.hidden.has(n.type));
            if (first) { this.setFocus(first.id); this.centerOn(first); }
          }
          if (e.key === 'Escape') { search.value = ''; this.search = ''; this.canvas.focus(); this.requestFrame(); }
        });
      }
      const on = (sel, ev, fn) => { const el = tb.querySelector(sel); if (el) el.addEventListener(ev, fn); };
      on('.map-layout', 'change', e => { this.setLayout(e.target.value); this.api.post && this.api.post({ type: 'setting', id: 'accessMap.layout', value: e.target.value }); });
      on('.map-window', 'change', e => this.api.post && this.api.post({ type: 'setting', id: 'accessMap.timeWindowDays', value: e.target.value }));
      on('.map-labels', 'change', e => { this.labels = e.target.value; this.requestFrame(); this.api.post && this.api.post({ type: 'setting', id: 'accessMap.labels', value: e.target.value }); });
      on('.map-fit', 'click', () => { this.userAdjusted = false; this.fit(false); });
      on('.map-reset', 'click', () => this.relayoutAll());
      on('.map-replay', 'click', () => this.replayRecent());
      on('.map-png', 'click', () => this.exportPng());
      on('.map-full', 'click', () => this.toggleFullscreen());
    }
    setLayout(mode) {
      const prev = this.layout;
      this.layout = mode === 'radial' ? 'radial' : 'force';
      if (this.layout === 'radial') this.applyRadial(prev !== 'radial');
      else { for (const n of this.nodes.values()) n.pinned = false; this.settle(); }
      this.userAdjusted = false; this.fit(false);
    }
    scatter() {
      const cx = this.W / 2, cy = this.H / 2, Rx = this.W * 0.34 || 120, Ry = this.H * 0.34 || 120;
      for (const n of this.nodes.values()) { const rnd = seeded(n.id + ':r'); const a = rnd() * Math.PI * 2; const r = (n.type === 'task' ? 0.35 : 1) * (0.6 + rnd() * 0.6); n.x = cx + Math.cos(a) * r * Rx; n.y = cy + Math.sin(a) * r * Ry; n.vx = 0; n.vy = 0; }
    }
    centerOn(n) {
      const target = { scale: Math.max(this.view.scale, 1), tx: 0, ty: 0 };
      target.tx = this.W / 2 - n.x * target.scale; target.ty = this.H / 2 - n.y * target.scale;
      this.viewFrom = { ...this.view }; this.viewTo = target; this.viewTween = performance.now() + 450;
      this.userAdjusted = true; this.persist(); this.requestFrame();
    }
    exportPng() {
      try {
        const data = this.canvas.toDataURL('image/png');
        if (this.api.post) this.api.post({ type: 'savePng', data });
      } catch (e) { this.showOverlay('export failed', 1200); }
    }
    toggleFullscreen() {
      const el = this.host;
      if (document.fullscreenElement) { document.exitFullscreen && document.exitFullscreen(); return; }
      if (el.requestFullscreen) el.requestFullscreen().catch(() => this.showOverlay('fullscreen not available here', 1200));
    }
    hit(e) {
      const rect = this.canvas.getBoundingClientRect();
      const [x, y] = this.toWorld(e.clientX - rect.left, e.clientY - rect.top);
      let best = null, bestD = Math.pow(14 / this.view.scale, 2);
      for (const n of this.nodes.values()) {
        if (this.hidden.has(n.type)) continue;
        const dx = n.x - x, dy = n.y - y, d = dx * dx + dy * dy;
        const rr = Math.pow(this.radius(n) + 6 / this.view.scale, 2);
        if (d < Math.max(bestD, rr) && d < bestD + rr) { bestD = d; best = n; }
      }
      return best;
    }
    showTip(n, e) {
      if (!this.tip) return;
      if (!n || this.drag) { this.tip.hidden = true; return; }
      this.tip.innerHTML = `<div class="tip-type">${escapeHtml(TYPE_LABEL[n.type] || n.type)}${n.live ? ' · live' : ''}</div><div>${escapeHtml(n.label || n.id)}</div><div class="tip-type">${Number(n.degree) || 0} link${n.degree === 1 ? '' : 's'} · ${Number(n.reads) || 0} read · ${Number(n.writes) || 0} write · last ${escapeHtml(relTime(n.lastSeen))}</div>`;
      const rect = this.host.getBoundingClientRect();
      let x = e.clientX - rect.left + 14, y = e.clientY - rect.top + 14;
      this.tip.hidden = false;
      if (x + this.tip.offsetWidth > rect.width - 4) x = Math.max(4, x - this.tip.offsetWidth - 28);
      if (y + this.tip.offsetHeight > rect.height - 4) y = Math.max(4, y - this.tip.offsetHeight - 28);
      this.tip.style.left = x + 'px'; this.tip.style.top = y + 'px';
    }
    showMenu(n, e) {
      if (!this.menu) return;
      const items = [
        ['target', 'Focus & lineage', () => this.setFocus(n.id)],
        ['location', 'Center here', () => this.centerOn(n)],
        ['eye-closed', `Hide ${TYPE_LABEL[n.type] || n.type}s`, () => { this.hidden.add(n.type); if (this.focus === n.id) this.setFocus(null); this.buildLegend(); this.persist(); this.relayout(); }],
        ['copy', 'Copy name', () => this.api.post && this.api.post({ type: 'copy', text: n.label || n.id })],
        ['history', n.type === 'task' ? 'Show its runs' : 'Show runs that touched it', () => this.api.post && this.api.post({ type: 'filterHistory', text: n.label || n.id })],
      ];
      this.menu.innerHTML = items.map(([ic, label], i) => `<button class="menu-item" data-i="${i}"><i class="codicon codicon-${ic}"></i>${escapeHtml(label)}</button>`).join('');
      this.menu.querySelectorAll('.menu-item').forEach(b => b.addEventListener('click', () => { items[Number(b.dataset.i)][2](); this.hideMenu(); }));
      const rect = this.host.getBoundingClientRect();
      let x = e.clientX - rect.left, y = e.clientY - rect.top;
      this.menu.hidden = false;
      if (x + this.menu.offsetWidth > rect.width - 4) x = Math.max(4, rect.width - this.menu.offsetWidth - 4);
      if (y + this.menu.offsetHeight > rect.height - 4) y = Math.max(4, rect.height - this.menu.offsetHeight - 4);
      this.menu.style.left = x + 'px'; this.menu.style.top = y + 'px';
      const close = ev => { if (!this.menu.contains(ev.target)) { this.hideMenu(); document.removeEventListener('pointerdown', close, true); } };
      setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
    }
    hideMenu() { if (this.menu) this.menu.hidden = true; }
    showDetail(id) {
      if (!this.detail) return;
      const n = this.nodes.get(id);
      if (!n) { this.hideDetail(); return; }
      const lin = this.lineage && this.lineage.id === id ? this.lineage : this.computeLineage(id);
      const row = (other, meta) => `<button class="det-row" data-node="${escapeHtml(other.id)}"><i class="sw" style="background:${css(TYPE_VAR[other.type] || TYPE_VAR.other, FALLBACK[other.type] || FALLBACK.other)}"></i><span class="det-name">${escapeHtml(other.label || other.id)}</span><span class="det-meta">${escapeHtml(meta)}</span></button>`;
      const list = (ids, title, cls) => {
        const arr = Array.from(ids).map(i => this.nodes.get(i)).filter(Boolean).sort((a, b) => (a.label || '').localeCompare(b.label || ''));
        if (!arr.length) return '';
        return `<div class="det-group ${cls}"><div class="det-h">${escapeHtml(title)} <span class="n">${arr.length}</span></div>${arr.slice(0, 30).map(o => {
          const e = this.edges.find(x => (x.from === id && x.to === o.id) || (x.to === id && x.from === o.id));
          return row(o, e ? `${e.mode} ×${Number(e.count) || 1} · ${relTime(e.lastSeen)}` : '2 hops');
        }).join('')}${arr.length > 30 ? `<div class="tip-type">+${arr.length - 30} more</div>` : ''}</div>`;
      };
      const isTask = n.type === 'task';
      const body = isTask
        ? list(lin.up, 'Reads (inputs)', 'up') + list(lin.down, 'Writes (outputs)', 'down') + list(lin.down2, 'Downstream scripts (read what this writes)', 'down2') + list(lin.up2, 'Upstream scripts (write what this reads)', 'up2')
        : list(lin.up, 'Written by', 'up') + list(lin.down, 'Read by', 'down') + list(lin.down2, 'Downstream (what those readers write)', 'down2') + list(lin.up2, 'Upstream (what those writers read)', 'up2');
      const impact = isTask ? lin.down2.size : lin.down.size;
      this.detail.innerHTML = `<div class="det-head"><span class="tip-type">${escapeHtml(TYPE_LABEL[n.type] || n.type)}${n.live ? ' · live' : ''}</span><button class="icon-btn det-close" title="Close (Esc)"><i class="codicon codicon-close"></i></button></div>
        <div class="det-title">${escapeHtml(n.label || n.id)}</div>
        <div class="tip-type">${Number(n.degree) || 0} link${n.degree === 1 ? '' : 's'} · ${Number(n.reads) || 0} read · ${Number(n.writes) || 0} write · last ${escapeHtml(relTime(n.lastSeen))}</div>
        ${impact ? `<div class="det-impact"><i class="codicon codicon-warning"></i> If this ${isTask ? 'script fails' : 'breaks'}, ${impact} ${isTask ? 'downstream script' : 'reader'}${impact === 1 ? '' : 's'} ${isTask ? 'lose their input' : 'are affected'}.</div>` : ''}
        <div class="det-links">${body || '<div class="tip-type">no links</div>'}</div>
        <div class="det-actions"><button class="link-btn det-center">Center</button><button class="link-btn det-runs">Runs</button><button class="link-btn det-hide">Hide ${escapeHtml(TYPE_LABEL[n.type] || n.type)}s</button></div>`;
      this.detail.hidden = false;
      this.detail.querySelector('.det-close').addEventListener('click', () => this.setFocus(null));
      this.detail.querySelector('.det-center').addEventListener('click', () => this.centerOn(n));
      this.detail.querySelector('.det-runs').addEventListener('click', () => this.api.post && this.api.post({ type: 'filterHistory', text: n.label || n.id }));
      this.detail.querySelector('.det-hide').addEventListener('click', () => { this.hidden.add(n.type); this.setFocus(null); this.buildLegend(); this.persist(); this.relayout(); });
      this.detail.querySelectorAll('.det-row').forEach(b => b.addEventListener('click', () => { const id2 = b.dataset.node; if (this.nodes.has(id2)) { this.setFocus(id2); this.centerOn(this.nodes.get(id2)); } }));
    }
    hideDetail() { if (this.detail) this.detail.hidden = true; }
    relayout() { if (this.layout === 'radial') this.applyRadial(true); else this.settle(); this.requestFrame(); }
    buildLegend() {
      if (!this.legend) return;
      const counts = {};
      for (const n of this.nodes.values()) counts[n.type] = (counts[n.type] || 0) + 1;
      this.legend.replaceChildren();
      for (const type of TYPE_ORDER) {
        if (!counts[type]) continue;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = this.hidden.has(type) ? 'off' : '';
        b.title = `Click to ${this.hidden.has(type) ? 'show' : 'hide'} ${TYPE_LABEL[type]}`;
        const sw = document.createElement('span'); sw.className = 'swatch'; sw.style.background = css(TYPE_VAR[type], FALLBACK[type]);
        b.append(sw, document.createTextNode(`${TYPE_LABEL[type]} `));
        const n = document.createElement('span'); n.className = 'n'; n.textContent = String(counts[type]); b.append(n);
        b.addEventListener('click', () => { if (this.hidden.has(type)) this.hidden.delete(type); else this.hidden.add(type); this.buildLegend(); this.persist(); this.relayout(); });
        this.legend.append(b);
      }
      const key = document.createElement('span');
      key.className = 'edge-key';
      key.innerHTML = '<span class="k-write"></span> write <span class="k-read"></span> read';
      this.legend.append(key);
    }
  }

  function hostOf(section) { return section.classList && section.classList.contains('map-host') ? section : section.querySelector('.map-host'); }
  window.AccessMap = {
    attach(section, api) {
      const host = hostOf(section);
      if (!host) return null;
      let inst = instances.get(host);
      if (!inst) { inst = new AccessMap(section, api, false); instances.set(host, inst); }
      else { inst.section = section; inst.legend = section.querySelector('.map-legend') || inst.legend; inst.toolbar = section.querySelector('.map-toolbar') || inst.toolbar; }
      return inst;
    },
    update(section, graph, options) {
      const inst = window.AccessMap.attach(section, options && options.api);
      if (inst) inst.update(graph, options);
    },
    replay(section, rp) { const host = hostOf(section); const inst = host && instances.get(host); if (inst) inst.replay(rp); },
    mini(host, graph, api) {
      let inst = instances.get(host);
      if (!inst) { inst = new AccessMap(host, api, true); instances.set(host, inst); }
      inst.update(graph, {});
      inst.fit(true);
    },
    has(section) { const host = hostOf(section); return !!host && instances.has(host); },
    /** Dev-only peek at an instance (the harness uses it); not part of the page contract. */
    inspect(section) {
      const host = hostOf(section) || section; const inst = host && instances.get(host);
      if (!inst) return null;
      const nodes = Array.from(inst.nodes.values());
      return { layout: inst.layout, settleUntil: inst.settleUntil, now: performance.now(), raf: inst.raf, W: inst.W, H: inst.H, nodes: nodes.length, pinned: nodes.filter(n => n.pinned).length, reducedMotion, userAdjusted: inst.userAdjusted, view: inst.view, firstLayout: inst.firstLayout, wasSettling: inst.wasSettling, edgeKey: (inst.edgeKey || '').length };
    },
  };
})();
