// Access Map: a small 2D constellation of scripts (tasks) and the resources they touch.
// Plain Canvas 2D, no libraries. Ported from a larger 3D neural-map preview, keeping only
// what earns its place in an IDE panel:
//   - force-directed layout that settles in ~2 s and then holds still (nothing "breathes")
//   - edge width from use count; the running task's edges pulse
//   - click a node to focus its neighbourhood; click the legend to hide a type
//   - deterministic starting positions (seeded from node ids), so the map looks the same each time
// Everything visual reads its colour from VS Code theme variables.
(function () {
  'use strict';

  const TYPE_ORDER = ['task', 'table', 'file', 'api', 'other'];
  const TYPE_LABEL = { task: 'Script', table: 'Table / view', file: 'File', api: 'API / service', other: 'Other' };
  const TYPE_VAR = {
    task: '--vscode-charts-blue',
    table: '--vscode-charts-purple',
    file: '--vscode-charts-orange',
    api: '--vscode-charts-green',
    other: '--vscode-charts-yellow',
  };
  const FALLBACK = { task: '#3794ff', table: '#b180d7', file: '#d18616', api: '#89d185', other: '#cca700' };

  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // One map instance per host element.
  const instances = new WeakMap();

  function css(name, fallback) {
    const v = getComputedStyle(document.body).getPropertyValue(name).trim();
    return v || fallback;
  }

  // Deterministic pseudo-random from a string, so first positions do not jump between sessions.
  function seeded(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return () => {
      h += 0x6D2B79F5;
      let t = Math.imul(h ^ (h >>> 15), 1 | h);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  class AccessMap {
    constructor(host) {
      this.host = host;
      this.canvas = host.querySelector('canvas');
      this.tip = host.querySelector('.map-tip');
      this.legend = document.getElementById('map-legend');
      this.ctx = this.canvas.getContext('2d');
      this.nodes = new Map();     // id -> node with x,y,vx,vy
      this.edges = [];
      this.hidden = new Set();    // hidden types
      this.focus = null;
      this.hover = null;
      this.settleUntil = 0;
      this.raf = 0;
      this.activeTask = null;
      this.W = 0; this.H = 0; this.dpr = 1;
      this.resize();
      this.ro = new ResizeObserver(() => { this.resize(); this.requestFrame(); });
      this.ro.observe(host);
      this.bind();
    }

    // ---- data in ------------------------------------------------------------------------
    update(graph) {
      const seen = new Set();
      const cx = this.W / 2, cy = this.H / 2;
      const R = Math.min(this.W, this.H) * 0.35 || 120;
      for (const n of graph.nodes) {
        seen.add(n.id);
        let node = this.nodes.get(n.id);
        if (!node) {
          const rnd = seeded(n.id);
          const a = rnd() * Math.PI * 2;
          const r = (n.type === 'task' ? 0.35 : 1) * R * (0.6 + rnd() * 0.6);
          node = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, vx: 0, vy: 0 };
          this.nodes.set(n.id, node);
        }
        Object.assign(node, n); // id, type, label, lastSeen, live, degree
      }
      for (const id of Array.from(this.nodes.keys())) if (!seen.has(id)) this.nodes.delete(id);
      this.edges = graph.edges.filter(e => this.nodes.has(e.from) && this.nodes.has(e.to));
      this.activeTask = graph.activeTask;
      if (this.focus && !this.nodes.has(this.focus)) this.focus = null;
      this.buildLegend();
      this.settle();
    }

    settle() {
      if (reducedMotion) {
        for (let i = 0; i < 300; i++) this.step(1);
        this.settleUntil = 0;
      } else {
        this.settleUntil = performance.now() + 2500;
      }
      this.requestFrame();
    }

    // ---- layout physics -------------------------------------------------------------------
    step(dt) {
      const nodes = Array.from(this.nodes.values()).filter(n => !this.hidden.has(n.type));
      const cx = this.W / 2, cy = this.H / 2;
      const k = 1200; // repulsion strength
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        // gravity toward centre, stronger for tasks so they sit inside
        const g = a.type === 'task' ? 0.03 : 0.012;
        a.vx += (cx - a.x) * g * dt;
        a.vy += (cy - a.y) * g * dt;
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy;
          if (d2 < 1) { dx = 0.5; dy = 0.5; d2 = 0.5; }
          const d = Math.sqrt(d2);
          const f = Math.min(k / d2, 6) * dt;
          const fx = (dx / d) * f, fy = (dy / d) * f;
          a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
        }
      }
      for (const e of this.edges) {
        const a = this.nodes.get(e.from), b = this.nodes.get(e.to);
        if (!a || !b || this.hidden.has(a.type) || this.hidden.has(b.type)) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        const rest = 70 + Math.min(40, (a.degree + b.degree) * 3);
        const f = (d - rest) * 0.02 * dt;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx += fx; a.vy += fy; b.vx -= fx; b.vy -= fy;
      }
      const pad = 18;
      for (const n of nodes) {
        n.vx *= 0.82; n.vy *= 0.82;
        n.x += n.vx; n.y += n.vy;
        n.x = Math.max(pad, Math.min(this.W - pad, n.x));
        n.y = Math.max(pad, Math.min(this.H - pad, n.y));
      }
    }

    // ---- drawing ---------------------------------------------------------------------------
    requestFrame() {
      if (!this.raf) this.raf = requestAnimationFrame(t => this.frame(t));
    }

    frame(t) {
      this.raf = 0;
      const settling = t < this.settleUntil;
      if (settling) this.step(1);
      this.draw(t);
      const hasLive = !reducedMotion && this.edges.some(e => e.live);
      if (settling || hasLive) this.requestFrame();
    }

    draw(t) {
      const ctx = this.ctx;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.W, this.H);
      const fg = css('--vscode-foreground', '#ccc');
      const font = css('--vscode-font-family', 'sans-serif');
      const neighbours = this.focus ? this.neighbourSet(this.focus) : null;
      const pulse = 0.5 + 0.5 * Math.sin(t / 220);

      // edges
      for (const e of this.edges) {
        const a = this.nodes.get(e.from), b = this.nodes.get(e.to);
        if (!a || !b || this.hidden.has(a.type) || this.hidden.has(b.type)) continue;
        const dim = neighbours && !(neighbours.has(e.from) && neighbours.has(e.to));
        const width = 0.8 + Math.min(4, Math.log2(1 + (e.count || 1)));
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        if (e.live) {
          ctx.strokeStyle = css('--vscode-charts-blue', FALLBACK.task);
          ctx.globalAlpha = dim ? 0.15 : (reducedMotion ? 0.9 : 0.55 + 0.45 * pulse);
          ctx.lineWidth = width + (reducedMotion ? 1 : pulse * 1.5);
        } else {
          ctx.strokeStyle = fg;
          ctx.globalAlpha = dim ? 0.05 : (e.mode === 'write' ? 0.42 : 0.26);
          ctx.lineWidth = width;
        }
        if (e.mode === 'write') ctx.setLineDash([]); else ctx.setLineDash([4, 3]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.globalAlpha = 1;

      // nodes
      const many = this.nodes.size > 40;
      ctx.textBaseline = 'middle';
      for (const n of this.nodes.values()) {
        if (this.hidden.has(n.type)) continue;
        const dim = neighbours && !neighbours.has(n.id);
        const color = css(TYPE_VAR[n.type] || TYPE_VAR.other, FALLBACK[n.type] || FALLBACK.other);
        const r = (n.type === 'task' ? 7 : 4.5) + Math.min(6, Math.sqrt(n.degree || 0) * 1.4);
        ctx.globalAlpha = dim ? 0.18 : 1;
        if (n.live && !reducedMotion) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 4 + pulse * 5, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.globalAlpha = dim ? 0.05 : 0.18 * (1 - pulse) + 0.06;
          ctx.fill();
          ctx.globalAlpha = dim ? 0.18 : 1;
        }
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        if (n.id === this.focus || n.id === this.hover || n.id === this.activeTask) {
          ctx.lineWidth = 2;
          ctx.strokeStyle = fg;
          ctx.stroke();
        }
        const showLabel = n.type === 'task' || !many || n.id === this.hover || n.id === this.focus || (neighbours && neighbours.has(n.id));
        if (showLabel && !dim) {
          ctx.font = `${n.type === 'task' ? '600 ' : ''}11px ${font}`;
          ctx.fillStyle = fg;
          ctx.textAlign = 'left';
          ctx.fillText(truncate(n.label || n.id, 34), n.x + r + 4, n.y);
        }
      }
      ctx.globalAlpha = 1;

      if (this.nodes.size === 0) {
        ctx.fillStyle = css('--vscode-descriptionForeground', '#999');
        ctx.font = `12px ${font}`;
        ctx.textAlign = 'center';
        ctx.fillText('No access data yet', this.W / 2, this.H / 2);
      }
    }

    neighbourSet(id) {
      const s = new Set([id]);
      for (const e of this.edges) {
        if (e.from === id) s.add(e.to);
        if (e.to === id) s.add(e.from);
      }
      return s;
    }

    // ---- interaction --------------------------------------------------------------------
    bind() {
      const c = this.canvas;
      c.addEventListener('mousemove', e => {
        const n = this.hit(e);
        const id = n ? n.id : null;
        if (id !== this.hover) {
          this.hover = id;
          c.style.cursor = n ? 'pointer' : 'default';
          this.requestFrame();
        }
        this.showTip(n, e);
      });
      c.addEventListener('mouseleave', () => { this.hover = null; this.showTip(null); this.requestFrame(); });
      c.addEventListener('click', e => {
        const n = this.hit(e);
        this.focus = n ? (this.focus === n.id ? null : n.id) : null;
        this.requestFrame();
      });
      c.addEventListener('dblclick', () => { this.focus = null; this.settle(); });
    }

    hit(e) {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left, y = e.clientY - rect.top;
      let best = null, bestD = 14 * 14;
      for (const n of this.nodes.values()) {
        if (this.hidden.has(n.type)) continue;
        const dx = n.x - x, dy = n.y - y;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = n; }
      }
      return best;
    }

    showTip(n, e) {
      if (!this.tip) return;
      if (!n) { this.tip.hidden = true; return; }
      const reads = this.edges.filter(x => x.to === n.id && x.mode === 'read').length + this.edges.filter(x => x.from === n.id && x.mode === 'read').length;
      const writes = this.edges.filter(x => x.to === n.id && x.mode === 'write').length + this.edges.filter(x => x.from === n.id && x.mode === 'write').length;
      this.tip.innerHTML = `<div class="tip-type">${TYPE_LABEL[n.type] || n.type}${n.live ? ' · live' : ''}</div><div>${escapeHtml(n.label || n.id)}</div><div class="tip-type">${n.degree} link${n.degree === 1 ? '' : 's'} · ${reads} read · ${writes} write · last ${escapeHtml(relTime(n.lastSeen))}</div>`;
      const rect = this.host.getBoundingClientRect();
      let x = e.clientX - rect.left + 12, y = e.clientY - rect.top + 12;
      this.tip.hidden = false;
      if (x + this.tip.offsetWidth > rect.width - 4) x = Math.max(4, x - this.tip.offsetWidth - 24);
      if (y + this.tip.offsetHeight > rect.height - 4) y = Math.max(4, y - this.tip.offsetHeight - 24);
      this.tip.style.left = x + 'px';
      this.tip.style.top = y + 'px';
    }

    buildLegend() {
      if (!this.legend) return;
      const present = new Set(Array.from(this.nodes.values()).map(n => n.type));
      this.legend.replaceChildren();
      for (const type of TYPE_ORDER) {
        if (!present.has(type)) continue;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = this.hidden.has(type) ? 'off' : '';
        b.title = `Click to ${this.hidden.has(type) ? 'show' : 'hide'} ${TYPE_LABEL[type]}`;
        const sw = document.createElement('span');
        sw.className = 'swatch';
        sw.style.background = css(TYPE_VAR[type], FALLBACK[type]);
        b.append(sw, document.createTextNode(TYPE_LABEL[type]));
        b.addEventListener('click', () => {
          if (this.hidden.has(type)) this.hidden.delete(type); else this.hidden.add(type);
          this.buildLegend();
          this.settle();
        });
        this.legend.append(b);
      }
    }

    resize() {
      const rect = this.host.getBoundingClientRect();
      this.dpr = window.devicePixelRatio || 1;
      this.W = Math.max(50, rect.width);
      this.H = Math.max(50, rect.height);
      this.canvas.width = Math.round(this.W * this.dpr);
      this.canvas.height = Math.round(this.H * this.dpr);
    }
  }

  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + '…' : s; }
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

  window.AccessMap = {
    update(host, graph) {
      let inst = instances.get(host);
      if (!inst) { inst = new AccessMap(host); instances.set(host, inst); }
      inst.update(graph);
    },
  };
})();
