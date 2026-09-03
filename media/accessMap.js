// Access Map: a constellation of scripts (tasks) and the resources they touch.
// Plain Canvas 2D, no libraries. Everything visual reads its colour from VS Code theme variables.
//
//   window.AccessMap.attach(section, api)   wire a section's toolbar + canvas (once)
//   window.AccessMap.update(section, graph, options)   new data / options
//   window.AccessMap.replay(section, replay)  animate a finished run's path
//   window.AccessMap.mini(host, graph)        static preview for the sidebar
//
// Interaction: drag background = pan · wheel = zoom about the cursor · drag a node = move (pins it)
// · click = focus + detail card · double-click = reset · search box · legend = hide a type ·
// layout force | radial · labels auto | all | scripts. Honours prefers-reduced-motion.
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
    // Accepts #rgb, #rrggbb, rgb(a)(); returns rgba().
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
  // Deterministic pseudo-random from a string, so first positions do not jump between sessions.
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
  const easeOut = t => 1 - Math.pow(1 - t, 3);

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
      this.legend = mini ? null : section.querySelector('.map-legend');
      this.toolbar = mini ? null : section.querySelector('.map-toolbar');

      this.nodes = new Map();      // id -> node with x,y,vx,vy,pinned,born
      this.edges = [];
      this.hidden = new Set();
      this.focus = null;
      this.hover = null;
      this.search = '';
      this.layout = 'force';
      this.labels = 'auto';
      this.view = { scale: 1, tx: 0, ty: 0 };
      this.settleUntil = 0;
      this.tweenUntil = 0;
      this.particles = [];
      this.replays = [];
      this.raf = 0;
      this.drag = null;
      this.lastFrame = 0;
      this.W = 0; this.H = 0; this.dpr = 1;
      this.firstLayout = true;

      const saved = (this.api.getState && this.api.getState()) || null;
      if (saved && saved.hidden) this.hidden = new Set(saved.hidden);
      if (saved && saved.view && typeof saved.view.scale === 'number') this.view = saved.view;
      if (saved && saved.focus) this.focus = saved.focus;

      this.resize();
      this.userAdjusted = false; // set once the user pans or zooms; until then the view auto-fits on resize
      // Editor groups animate their width, so a resize arrives as a burst; fit once it goes quiet.
      this.fitTimer = 0;
      this.ro = new ResizeObserver(() => {
        const before = this.W * this.H;
        this.resize();
        const after = this.W * this.H;
        this.requestFrame();
        if (this.userAdjusted || !this.nodes.size || before <= 0 || Math.abs(after - before) / before < 0.05) return;
        clearTimeout(this.fitTimer);
        this.fitTimer = setTimeout(() => { if (!this.userAdjusted) this.fit(true); }, 180);
      });
      this.ro.observe(this.host);
      if (!mini) { this.bind(); this.bindToolbar(); }
      else this.host.addEventListener('click', () => this.api.post && this.api.post({ type: 'openMap' }));
    }

    // ---------------------------------------------------------------- data in
    update(graph, options) {
      options = options || {};
      const prevLayout = this.layout;
      if (options.layout) this.layout = options.layout;
      if (options.labels) this.labels = options.labels;
      if (this.toolbar) {
        const l = this.toolbar.querySelector('.map-layout'); if (l && options.layout) l.value = options.layout;
        const w = this.toolbar.querySelector('.map-window'); if (w && typeof options.timeWindowDays === 'number') w.value = String([0, 1, 7, 30].includes(options.timeWindowDays) ? options.timeWindowDays : 0);
        const lb = this.toolbar.querySelector('.map-labels'); if (lb && options.labels) lb.value = options.labels;
      }
      const seen = new Set();
      const now = performance.now();
      const cx = this.W / 2, cy = this.H / 2;
      const R = Math.min(this.W, this.H) * 0.34 || 120;
      const hadNodes = this.nodes.size > 0;
      for (const n of graph.nodes) {
        seen.add(n.id);
        let node = this.nodes.get(n.id);
        if (!node) {
          const rnd = seeded(n.id);
          const a = rnd() * Math.PI * 2;
          const r = (n.type === 'task' ? 0.35 : 1) * R * (0.6 + rnd() * 0.6);
          node = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, vx: 0, vy: 0, pinned: false, born: hadNodes && !reducedMotion ? now : 0 };
          this.nodes.set(n.id, node);
        }
        Object.assign(node, n); // id, type, label, lastSeen, live, degree, reads, writes
      }
      for (const id of Array.from(this.nodes.keys())) if (!seen.has(id)) this.nodes.delete(id);
      this.edges = graph.edges.filter(e => this.nodes.has(e.from) && this.nodes.has(e.to));
      this.activeTasks = graph.activeTasks || [];
      this.dropped = graph.dropped || 0;
      if (this.focus && !this.nodes.has(this.focus)) { this.focus = null; this.hideDetail(); }
      this.buildLegend();
      if (this.layout === 'radial') this.applyRadial(prevLayout !== 'radial' || this.firstLayout);
      else this.settle();
      if (this.firstLayout && (!this.api.getState || !this.api.getState() || !this.api.getState().view)) this.fit(true);
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
      // One pulse per touched resource, staggered, so the run's path plays through the map.
      const t0 = performance.now();
      ids.forEach((to, i) => this.replays.push({ from, to, start: t0 + i * 220, dur: 900 }));
      this.requestFrame();
    }

    // ---------------------------------------------------------------- layouts
    settle() {
      if (reducedMotion) { for (let i = 0; i < 300; i++) this.step(1); this.settleUntil = 0; }
      else this.settleUntil = performance.now() + 2600;
      this.requestFrame();
    }

    /** Scripts on an inner ring, resources on an outer ring grouped by type; tween there. */
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
      // Outer ring: sectors by type in TYPE_ORDER, items sorted by their strongest task then label.
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
      for (const n of visible) {
        n.pinned = true; n.vx = 0; n.vy = 0;
        n.fx = n.x; n.fy = n.y;
      }
      this.settleUntil = 0;
      if (animate && !reducedMotion) this.tweenUntil = performance.now() + 700;
      else { for (const n of visible) { n.x = n.tx; n.y = n.ty; } this.tweenUntil = 0; }
      this.requestFrame();
    }

    step(dt) {
      const nodes = Array.from(this.nodes.values()).filter(n => !this.hidden.has(n.type));
      const cx = this.W / 2, cy = this.H / 2;
      // Repulsion grows with the label length so long names get room; hubs push harder.
      const k = 2600;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        const g = a.type === 'task' ? 0.03 : 0.012;
        a.vx += (cx - a.x) * g * dt; a.vy += (cy - a.y) * g * dt;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = 0.5; dy = 0.5; d2 = 0.5; }
          const d = Math.sqrt(d2);
          // Scripts repel each other hardest so hubs (and their label clusters) spread apart.
          const boost = (a.type === 'task' && b.type === 'task') ? 5 : (a.type === 'task' || b.type === 'task') ? 1.6 : 1;
          const f = Math.min(k * boost / d2, 9) * dt;
          const fx = (dx / d) * f, fy = (dy / d) * f;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
      }
      for (const e of this.edges) {
        const a = this.nodes.get(e.from), b = this.nodes.get(e.to);
        if (!a || !b || this.hidden.has(a.type) || this.hidden.has(b.type)) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const rest = 110 + Math.min(70, (a.degree + b.degree) * 4);
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
    fit(instant) {
      const nodes = Array.from(this.nodes.values()).filter(n => !this.hidden.has(n.type));
      if (!nodes.length) { this.view = { scale: 1, tx: 0, ty: 0 }; return; }
      const pts = nodes.map(n => [n.tx !== undefined && this.layout === 'radial' ? n.tx : n.x, n.ty !== undefined && this.layout === 'radial' ? n.ty : n.y]);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of pts) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
      const pad = 70;
      const w = Math.max(60, maxX - minX + pad * 2), h = Math.max(60, maxY - minY + pad * 2);
      const scale = Math.max(0.25, Math.min(1.6, Math.min(this.W / w, this.H / h)));
      const target = { scale, tx: this.W / 2 - ((minX + maxX) / 2) * scale, ty: this.H / 2 - ((minY + maxY) / 2) * scale };
      if (instant || reducedMotion) this.view = target;
      else { this.viewFrom = { ...this.view }; this.viewTo = target; this.viewTween = performance.now() + 450; }
      this.persist();
      this.requestFrame();
    }
    persist() {
      if (this.api.setState) this.api.setState({ view: this.view, hidden: Array.from(this.hidden), focus: this.focus });
    }

    // ---------------------------------------------------------------- drawing
    requestFrame() { if (!this.raf) this.raf = requestAnimationFrame(t => this.frame(t)); }
    frame(t) {
      this.raf = 0;
      let animating = false;
      if (t < this.settleUntil) { this.step(1); animating = true; this.wasSettling = true; }
      else if (this.wasSettling) {
        // The layout just came to rest: frame it once more unless the user has taken the wheel.
        this.wasSettling = false;
        if (!this.userAdjusted) this.fit(true);
      }
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
      const live = !reducedMotion && !this.mini && (this.edges.some(e => e.live) || this.replays.length || this.particles.length || Array.from(this.nodes.values()).some(n => n.born && t - n.born < 2000));
      if (animating || live) this.requestFrame();
    }

    draw(t) {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
      const fg = css('--vscode-foreground', '#ccc');
      const bg = css('--vscode-editor-background', '#1e1e1e');
      const font = css('--vscode-font-family', 'sans-serif');
      const color = type => css(TYPE_VAR[type] || TYPE_VAR.other, FALLBACK[type] || FALLBACK.other);
      const s = this.view.scale;
      const neighbours = this.focus ? this.neighbourSet(this.focus) : null;
      const q = this.search;
      const matches = q ? new Set(Array.from(this.nodes.values()).filter(n => (n.label || n.id).toLowerCase().includes(q)).map(n => n.id)) : null;
      const isDim = id => (neighbours && !neighbours.has(id)) || (matches && !matches.has(id));
      const hoverSet = this.hover ? this.neighbourSet(this.hover) : null;
      const pulse = 0.5 + 0.5 * Math.sin(t / 240);
      const many = this.nodes.size > 40;

      ctx.save();
      ctx.translate(this.view.tx, this.view.ty);
      ctx.scale(s, s);

      // Soft halos behind script hubs.
      if (!this.mini) {
        for (const n of this.nodes.values()) {
          if (n.type !== 'task' || this.hidden.has(n.type)) continue;
          const r = 60 + Math.min(60, n.degree * 6);
          const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, r);
          const c = color('task');
          g.addColorStop(0, withAlpha(c, isDim(n.id) ? 0.03 : 0.10));
          g.addColorStop(1, withAlpha(c, 0));
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2); ctx.fill();
        }
      }

      // Edges: gently curved so parallel links read separately.
      for (const e of this.edges) {
        const a = this.nodes.get(e.from), b = this.nodes.get(e.to);
        if (!a || !b || this.hidden.has(a.type) || this.hidden.has(b.type)) continue;
        const dim = isDim(e.from) || isDim(e.to);
        const hot = hoverSet && (e.from === this.hover || e.to === this.hover);
        const width = (0.8 + Math.min(4, Math.log2(1 + (e.count || 1)))) / Math.sqrt(s);
        const [mx, my] = this.ctrl(a, b);
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mx, my, b.x, b.y);
        if (e.live) {
          ctx.strokeStyle = color('task');
          ctx.globalAlpha = dim ? 0.12 : 0.5 + 0.4 * pulse;
          ctx.lineWidth = width + 1;
        } else {
          ctx.strokeStyle = hot ? color(b.type) : fg;
          ctx.globalAlpha = dim ? 0.05 : hot ? 0.85 : e.mode === 'write' ? 0.38 : 0.22;
          ctx.lineWidth = hot ? width + 0.6 : width;
        }
        ctx.setLineDash(e.mode === 'write' ? [] : [5 / s, 4 / s]);
        ctx.stroke();
        ctx.setLineDash([]);
        // Small arrowhead for writes (data flows into the resource).
        if (e.mode === 'write' && !dim && s > 0.6) {
          const ang = Math.atan2(b.y - my, b.x - mx);
          const rb = this.radius(b) + 2;
          const px = b.x - Math.cos(ang) * rb, py = b.y - Math.sin(ang) * rb;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px - Math.cos(ang - 0.5) * 6 / s, py - Math.sin(ang - 0.5) * 6 / s);
          ctx.lineTo(px - Math.cos(ang + 0.5) * 6 / s, py - Math.sin(ang + 0.5) * 6 / s);
          ctx.closePath();
          ctx.fillStyle = ctx.strokeStyle; ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // Live particles along running tasks' edges, and replay pulses.
      if (!reducedMotion && !this.mini) {
        for (const e of this.edges) {
          if (!e.live) continue;
          const a = this.nodes.get(e.from), b = this.nodes.get(e.to);
          if (!a || !b || this.hidden.has(a.type) || this.hidden.has(b.type)) continue;
          const [mx, my] = this.ctrl(a, b);
          for (let i = 0; i < 2; i++) {
            const k = ((t / 1400) + i * 0.5 + (e.count || 1) * 0.13) % 1;
            const [px, py] = this.bez(a, mx, my, b, e.mode === 'write' ? k : 1 - k);
            ctx.beginPath(); ctx.arc(px, py, 2.4 / Math.sqrt(s), 0, Math.PI * 2);
            ctx.fillStyle = color('task'); ctx.globalAlpha = 0.9; ctx.fill();
          }
        }
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
      for (const n of this.nodes.values()) {
        if (this.hidden.has(n.type)) continue;
        const dim = isDim(n.id);
        const c = color(n.type);
        const r = this.radius(n);
        ctx.globalAlpha = dim ? 0.18 : 1;
        // glow
        if (!this.mini) {
          const g = ctx.createRadialGradient(n.x, n.y, r * 0.5, n.x, n.y, r * 3.2);
          g.addColorStop(0, withAlpha(c, n.live ? 0.35 : 0.16)); g.addColorStop(1, withAlpha(c, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(n.x, n.y, r * 3.2, 0, Math.PI * 2); ctx.fill();
        }
        if (n.live && !reducedMotion) {
          ctx.beginPath(); ctx.arc(n.x, n.y, r + 3 + pulse * 6, 0, Math.PI * 2);
          ctx.strokeStyle = c; ctx.globalAlpha = (dim ? 0.05 : 0.5) * (1 - pulse); ctx.lineWidth = 1.5 / s; ctx.stroke();
          ctx.globalAlpha = dim ? 0.18 : 1;
        }
        if (n.born && t - n.born < 2000) {
          const k = (t - n.born) / 2000;
          ctx.beginPath(); ctx.arc(n.x, n.y, r + k * 34, 0, Math.PI * 2);
          ctx.strokeStyle = c; ctx.globalAlpha = (1 - k) * 0.8; ctx.lineWidth = 1.2 / s; ctx.stroke();
          ctx.globalAlpha = dim ? 0.18 : 1;
        }
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = c; ctx.fill();
        if (n.type === 'task') { ctx.beginPath(); ctx.arc(n.x, n.y, r * 0.45, 0, Math.PI * 2); ctx.fillStyle = bg; ctx.globalAlpha = dim ? 0.1 : 0.85; ctx.fill(); ctx.globalAlpha = dim ? 0.18 : 1; }
        if (n.id === this.focus || n.id === this.hover || (this.activeTasks || []).includes(n.id) || n.pinned && this.layout === 'force') {
          ctx.lineWidth = (n.id === this.focus ? 2.2 : 1.4) / s; ctx.strokeStyle = n.pinned && this.layout === 'force' && n.id !== this.focus && n.id !== this.hover ? withAlpha(fg, 0.5) : fg; ctx.beginPath(); ctx.arc(n.x, n.y, r + 1.5 / s, 0, Math.PI * 2); ctx.stroke();
        }
        // Labels
        const show = this.labels === 'all' || n.type === 'task' || (this.labels === 'auto' && (!many || n.id === this.hover || n.id === this.focus || (neighbours && neighbours.has(n.id)) || (matches && matches.has(n.id)))) || (this.mini && n.type === 'task');
        if (show && !dim && !(this.mini && n.type !== 'task')) {
          const size = (n.type === 'task' ? 12 : 11) / Math.max(0.75, Math.sqrt(s));
          ctx.font = `${n.type === 'task' ? '600 ' : ''}${size}px ${font}`;
          ctx.textAlign = 'left';
          const label = truncate(n.label || n.id, this.mini ? 18 : 36);
          const lx = n.x + r + 5 / s, ly = n.y;
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
        // Corner readout: zoom + counts.
        ctx.fillStyle = css('--vscode-descriptionForeground', '#999'); ctx.font = `10px ${font}`; ctx.textAlign = 'right';
        const visible = Array.from(this.nodes.values()).filter(n => !this.hidden.has(n.type)).length;
        ctx.fillText(`${visible} nodes · ${this.edges.length} links · ${Math.round(s * 100)}%${this.dropped ? ` · +${this.dropped} hidden` : ''}`, this.W - 8, this.H - 10);
      }
    }
    radius(n) { return (n.type === 'task' ? 8 : 4.5) + Math.min(7, Math.sqrt(n.degree || 0) * 1.5); }
    ctrl(a, b) {
      // Control point offset perpendicular to the chord, sign fixed per pair so both directions match.
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
      const sign = (a.id < b.id ? 1 : -1);
      const off = Math.min(28, d * 0.12) * sign;
      return [(a.x + b.x) / 2 - (dy / d) * off, (a.y + b.y) / 2 + (dx / d) * off];
    }
    bez(a, mx, my, b, k) {
      const u = 1 - k;
      return [u * u * a.x + 2 * u * k * mx + k * k * b.x, u * u * a.y + 2 * u * k * my + k * k * b.y];
    }
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
          // A click: focus / unfocus.
          const n = this.hit(e);
          if (n) { this.focus = this.focus === n.id ? null : n.id; if (this.focus) this.showDetail(n.id); else this.hideDetail(); }
          else { this.focus = null; this.hideDetail(); }
        }
        this.persist();
        this.requestFrame();
      };
      c.addEventListener('pointerup', end);
      c.addEventListener('pointercancel', () => { this.drag = null; c.classList.remove('grabbing'); });
      c.addEventListener('mouseleave', () => { this.hover = null; this.showTip(null); this.requestFrame(); });
      c.addEventListener('dblclick', e => {
        e.preventDefault();
        this.focus = null; this.hideDetail(); this.search = '';
        const inp = this.toolbar && this.toolbar.querySelector('.map-search'); if (inp) inp.value = '';
        for (const n of this.nodes.values()) n.pinned = this.layout === 'radial';
        if (this.layout === 'radial') this.applyRadial(true); else this.settle();
        this.fit(false);
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
        if (e.key === 'Escape') { this.focus = null; this.hideDetail(); this.requestFrame(); }
        if (e.key === 'f' || e.key === 'F') this.fit(false);
      });
      c.tabIndex = 0;
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
            if (first) { this.focus = first.id; this.showDetail(first.id); this.centerOn(first); }
          }
          if (e.key === 'Escape') { search.value = ''; this.search = ''; this.requestFrame(); }
        });
      }
      const layout = tb.querySelector('.map-layout');
      if (layout) layout.addEventListener('change', () => { this.setLayout(layout.value); this.api.post && this.api.post({ type: 'setting', id: 'accessMap.layout', value: layout.value }); });
      const win = tb.querySelector('.map-window');
      if (win) win.addEventListener('change', () => this.api.post && this.api.post({ type: 'setting', id: 'accessMap.timeWindowDays', value: win.value }));
      const labels = tb.querySelector('.map-labels');
      if (labels) labels.addEventListener('change', () => { this.labels = labels.value; this.requestFrame(); this.api.post && this.api.post({ type: 'setting', id: 'accessMap.labels', value: labels.value }); });
      const fit = tb.querySelector('.map-fit'); if (fit) fit.addEventListener('click', () => { this.userAdjusted = false; this.fit(false); });
      const reset = tb.querySelector('.map-reset'); if (reset) reset.addEventListener('click', () => { for (const n of this.nodes.values()) n.pinned = false; if (this.layout === 'radial') this.applyRadial(true); else { this.scatter(); this.settle(); } this.fit(false); });
    }
    setLayout(mode) {
      const prev = this.layout;
      this.layout = mode === 'radial' ? 'radial' : 'force';
      if (this.layout === 'radial') this.applyRadial(prev !== 'radial');
      else { for (const n of this.nodes.values()) n.pinned = false; this.settle(); }
      this.fit(false);
    }
    scatter() {
      const cx = this.W / 2, cy = this.H / 2, R = Math.min(this.W, this.H) * 0.34 || 120;
      for (const n of this.nodes.values()) { const rnd = seeded(n.id + ':r'); const a = rnd() * Math.PI * 2; const r = (n.type === 'task' ? 0.35 : 1) * R * (0.6 + rnd() * 0.6); n.x = cx + Math.cos(a) * r; n.y = cy + Math.sin(a) * r; n.vx = 0; n.vy = 0; }
    }
    centerOn(n) {
      const target = { scale: Math.max(this.view.scale, 1), tx: 0, ty: 0 };
      target.tx = this.W / 2 - n.x * target.scale; target.ty = this.H / 2 - n.y * target.scale;
      this.viewFrom = { ...this.view }; this.viewTo = target; this.viewTween = performance.now() + 450;
      this.persist(); this.requestFrame();
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
      this.tip.innerHTML = `<div class="tip-type">${TYPE_LABEL[n.type] || n.type}${n.live ? ' · live' : ''}</div><div>${escapeHtml(n.label || n.id)}</div><div class="tip-type">${n.degree} link${n.degree === 1 ? '' : 's'} · ${n.reads || 0} read · ${n.writes || 0} write · last ${escapeHtml(relTime(n.lastSeen))}</div>`;
      const rect = this.host.getBoundingClientRect();
      let x = e.clientX - rect.left + 14, y = e.clientY - rect.top + 14;
      this.tip.hidden = false;
      if (x + this.tip.offsetWidth > rect.width - 4) x = Math.max(4, x - this.tip.offsetWidth - 28);
      if (y + this.tip.offsetHeight > rect.height - 4) y = Math.max(4, y - this.tip.offsetHeight - 28);
      this.tip.style.left = x + 'px'; this.tip.style.top = y + 'px';
    }
    showDetail(id) {
      if (!this.detail) return;
      const n = this.nodes.get(id);
      if (!n) { this.hideDetail(); return; }
      const links = this.edges.filter(e => e.from === id || e.to === id).map(e => {
        const other = this.nodes.get(e.from === id ? e.to : e.from);
        return other ? { other, e } : null;
      }).filter(Boolean).sort((a, b) => (b.e.count || 0) - (a.e.count || 0));
      const rows = links.slice(0, 40).map(({ other, e }) => `<button class="det-row" data-node="${escapeHtml(other.id)}"><i class="sw" style="background:${css(TYPE_VAR[other.type], FALLBACK[other.type])}"></i><span class="det-name">${escapeHtml(other.label || other.id)}</span><span class="det-meta">${e.mode} ×${e.count || 1} · ${escapeHtml(relTime(e.lastSeen))}</span></button>`).join('');
      this.detail.innerHTML = `<div class="det-head"><span class="tip-type">${TYPE_LABEL[n.type] || n.type}${n.live ? ' · live' : ''}</span><button class="icon-btn det-close" title="Close"><i class="codicon codicon-close"></i></button></div>
        <div class="det-title">${escapeHtml(n.label || n.id)}</div>
        <div class="tip-type">${n.degree} link${n.degree === 1 ? '' : 's'} · ${n.reads || 0} read · ${n.writes || 0} write · last ${escapeHtml(relTime(n.lastSeen))}</div>
        <div class="det-links">${rows || '<div class="tip-type">no links</div>'}${links.length > 40 ? `<div class="tip-type">+${links.length - 40} more</div>` : ''}</div>
        <div class="det-actions"><button class="link-btn det-center">Center</button><button class="link-btn det-hide">Hide ${TYPE_LABEL[n.type] || n.type}s</button></div>`;
      this.detail.hidden = false;
      this.detail.querySelector('.det-close').addEventListener('click', () => { this.focus = null; this.hideDetail(); this.persist(); this.requestFrame(); });
      this.detail.querySelector('.det-center').addEventListener('click', () => this.centerOn(n));
      this.detail.querySelector('.det-hide').addEventListener('click', () => { this.hidden.add(n.type); this.focus = null; this.hideDetail(); this.buildLegend(); this.persist(); this.relayout(); });
      this.detail.querySelectorAll('.det-row').forEach(b => b.addEventListener('click', () => { const id2 = b.dataset.node; if (this.nodes.has(id2)) { this.focus = id2; this.showDetail(id2); this.centerOn(this.nodes.get(id2)); this.persist(); } }));
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
    }
  }

  window.AccessMap = {
    attach(section, api) {
      let inst = instances.get(section);
      if (!inst) { inst = new AccessMap(section, api, false); instances.set(section, inst); }
      return inst;
    },
    update(section, graph, options) {
      const inst = window.AccessMap.attach(section, options && options.api);
      inst.update(graph, options);
    },
    replay(section, rp) { const inst = instances.get(section); if (inst) inst.replay(rp); },
    mini(host, graph, api) {
      let inst = instances.get(host);
      if (!inst) { inst = new AccessMap(host, api, true); instances.set(host, inst); }
      inst.update(graph, {});
      inst.fit(true);
    },
    has(section) { return instances.has(section); },
  };
})();
