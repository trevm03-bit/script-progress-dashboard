// Script Progress Dashboard - Node.js reporter (no dependencies, CommonJS).
// Same file contract as python/progress.py. Copy this file into your project.
//
//   const { Progress } = require('./progress');
//   const p = new Progress('Nightly Export');
//   p.step(1, 2, 'Reading');  p.detail('412 rows');  p.warn('3 blank ids');
//   p.access('file', 'input/orders.csv');  p.metric('rows', 412);  p.trackDelta('rows', 412);
//   p.complete(true, 'wrote export.csv');
//
//   // or: await Progress.run('Nightly Export', async (p) => { ... });  (a throw is reported as FAILED)
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const HISTORY_KEEP = 100, DELTA_KEEP = 50, ACCESS_NODE_KEEP = 150, WARNINGS_IN_PROGRESS = 10, LOG_KEEP = 20, PRIOR_RUNS = 5;

const nowIso = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`; };
const slug = s => (String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60)) || 'task';

function resolveLogsDir(logsDir, moduleFile = __filename) {
  if (logsDir) return logsDir;
  if (process.env.PROGRESS_LOGS_DIR) return process.env.PROGRESS_LOGS_DIR;
  let dir = path.dirname(path.resolve(moduleFile));
  for (;;) {
    if (fs.existsSync(path.join(dir, 'logs')) || fs.existsSync(path.join(dir, '.git'))) return path.join(dir, 'logs');
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.join(process.cwd(), 'logs');
}

function readJson(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return def; }
}

function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;   // per-process, so concurrent writers never swap bytes
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  for (let i = 0; i < 5; i++) {
    try { fs.renameSync(tmp, file); return; } catch (e) { if (i === 4) { try { fs.unlinkSync(tmp); } catch {} throw e; } Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30 * (i + 1)); }
  }
}

class Progress {
  constructor(taskName, logsDir, opts = {}) {
    this.taskName = taskName;
    this.quiet = !!opts.quiet;
    this.logsDir = resolveLogsDir(logsDir);
    fs.mkdirSync(this.logsDir, { recursive: true });
    this.slotsDir = path.join(this.logsDir, 'progress');
    this.progressFile = path.join(this.logsDir, 'progress.json');
    this.slotFile = path.join(this.slotsDir, slug(taskName) + '.json');
    this.historyFile = path.join(this.logsDir, 'run_history.json');
    this.deltasFile = path.join(this.logsDir, 'deltas.json');
    this.accessFile = path.join(this.logsDir, 'access.json');
    this.runId = nowIso().replace(/[-:T]/g, '').slice(0, 15) + '-' + crypto.randomBytes(3).toString('hex');
    this.startTime = Date.now();
    this.startedAt = nowIso();
    this.warnings = []; this.logLines = []; this.metrics = {}; this.artifacts = []; this.accessed = [];
    this.completed = false;
    this.current = { step: 0, total: 0, label: 'Starting', detail: '', substep: null };
    const hist = readJson(this.historyFile, []);
    this.prior = (Array.isArray(hist) ? hist : []).filter(r => r && r.task === taskName && r.success && typeof r.elapsed === 'number').map(r => r.elapsed).slice(-PRIOR_RUNS);
    this._pruneSlots();
    this._write();
  }
  _pruneSlots() {
    // Finished slots older than 2 days, or 'running' slots older than 7 (a killed process), are dropped.
    let names = [];
    try { names = fs.readdirSync(this.slotsDir).filter(f => f.endsWith('.json')); } catch { return; }
    const now = Date.now();
    for (const f of names) {
      const p = path.join(this.slotsDir, f);
      if (p === this.slotFile) continue;
      try {
        const age = now - fs.statSync(p).mtimeMs;
        const data = readJson(p, {});
        const running = data && data.status === 'running';
        if ((!running && age > 2 * 86400000) || (running && age > 7 * 86400000)) fs.unlinkSync(p);
      } catch { /* one bad file never stops the sweep */ }
    }
  }
  _say(t) { if (!this.quiet) console.log(t); }
  step(n, total, label) { this.current = { step: n, total, label: String(label), detail: '', substep: null }; this._write(); this._say(`\n[${n}/${total}] ${label}...`); }
  detail(text) { this.current.detail = String(text); this._write(); this._say(`  ${text}`); }
  substep(f) { f = Math.max(0, Math.min(1, Number(f) || 0)); const prev = this.current.substep; this.current.substep = f; if (prev === null || Math.abs(f - prev) >= 0.01 || f >= 1) this._write(); }
  log(msg) { this.logLines.push({ time: nowIso(), msg: String(msg) }); this.logLines = this.logLines.slice(-LOG_KEEP); this._write(); this._say(`  ${msg}`); }
  warn(msg) { this.warnings.push({ time: nowIso(), msg: String(msg) }); this._write(); this._say(`  WARNING: ${msg}`); }
  metric(name, value) { this.metrics[String(name)] = typeof value === 'number' && Number.isFinite(value) ? value : String(value); this._write(); }
  artifact(p) { p = String(p); if (!this.artifacts.includes(p)) { this.artifacts.push(p); this._write(); } this._say(`  -> ${p}`); }
  trackDelta(name, value) {
    let d = readJson(this.deltasFile, {}); if (!d || typeof d !== 'object' || Array.isArray(d)) d = {};
    (d[name] = d[name] || []).push({ date: nowIso(), value: Number(value), task: this.taskName });
    d[name] = d[name].slice(-DELTA_KEEP); writeJson(this.deltasFile, d);
  }
  access(kind, name, mode = 'read') {
    kind = ['file', 'table', 'api', 'other'].includes(kind) ? kind : 'other';
    mode = String(mode).toLowerCase().startsWith('w') ? 'write' : 'read';
    const taskId = `task:${this.taskName}`, resId = `${kind}:${name}`, now = nowIso();
    let g = readJson(this.accessFile, { nodes: [], edges: [] }); if (!g || !Array.isArray(g.nodes)) g = { nodes: [], edges: [] };
    const nodes = new Map(g.nodes.filter(n => n && n.id).map(n => [n.id, n]));
    nodes.set(taskId, { id: taskId, type: 'task', label: this.taskName, lastSeen: now });
    nodes.set(resId, { id: resId, type: kind, label: String(name), lastSeen: now });
    const edges = (g.edges || []).filter(e => e && e.from);
    const e = edges.find(x => x.from === taskId && x.to === resId && x.mode === mode);
    if (e) { e.count = (e.count || 0) + 1; e.lastSeen = now; } else edges.push({ from: taskId, to: resId, mode, count: 1, lastSeen: now });
    const tasks = [...nodes.values()].filter(n => n.type === 'task');
    const res = [...nodes.values()].filter(n => n.type !== 'task').sort((a, b) => (b.lastSeen || '').localeCompare(a.lastSeen || ''));
    const keep = tasks.concat(res.slice(0, Math.max(0, ACCESS_NODE_KEEP - tasks.length)));
    const ids = new Set(keep.map(n => n.id));
    writeJson(this.accessFile, { nodes: keep, edges: edges.filter(x => ids.has(x.from) && ids.has(x.to)) });
    if (!this.accessed.includes(resId)) { this.accessed.push(resId); this._write(); }
  }
  complete(success = true, summary = '', metrics) {
    if (this.completed) return;
    if (metrics) for (const [k, v] of Object.entries(metrics)) this.metric(k, v);
    this.completed = true;
    const elapsed = (Date.now() - this.startTime) / 1000;
    this.current.label = success ? 'Complete' : 'FAILED'; this.current.detail = String(summary); this.current.substep = null;
    this._write(success ? 'complete' : 'failed');
    let hist = readJson(this.historyFile, []); if (!Array.isArray(hist)) hist = [];
    hist.push({ task: this.taskName, date: nowIso(), success: !!success, elapsed: Math.round(elapsed * 10) / 10, summary: String(summary), warnings: this.warnings.length,
      runId: this.runId, startedAt: this.startedAt, metrics: { ...this.metrics }, warningItems: this.warnings.slice(-20), accessed: [...this.accessed], artifacts: [...this.artifacts] });
    writeJson(this.historyFile, hist.slice(-HISTORY_KEEP));
    this._say(`\n=== ${success ? 'COMPLETE' : 'FAILED'} === (${Math.round(elapsed)}s)`); if (summary) this._say(`  ${summary}`);
  }
  _write(status = 'running') {
    const elapsed = (Date.now() - this.startTime) / 1000;
    const avg = this.prior.length ? this.prior.reduce((a, b) => a + b, 0) / this.prior.length : null;
    const data = { task: this.taskName, status, step: this.current.step, totalSteps: this.current.total, label: this.current.label, detail: this.current.detail, substep: this.current.substep,
      elapsed: Math.round(elapsed * 10) / 10, eta: status === 'running' && avg !== null ? Math.max(0, Math.round((avg - elapsed) * 10) / 10) : null,
      warnings: this.warnings.slice(-WARNINGS_IN_PROGRESS), log: this.logLines.slice(-LOG_KEEP), metrics: { ...this.metrics }, artifacts: [...this.artifacts], accessed: [...this.accessed],
      runId: this.runId, startedAt: this.startedAt, updatedAt: nowIso() };
    writeJson(this.progressFile, data);
    try { fs.mkdirSync(this.slotsDir, { recursive: true }); writeJson(this.slotFile, data); } catch {}
  }
  static async run(taskName, fn, logsDir) {
    const p = new Progress(taskName, logsDir);
    try { const r = await fn(p); if (!p.completed) p.complete(true, p.current.detail); return r; }
    catch (e) { if (!p.completed) p.complete(false, `Unhandled error: ${e && e.message ? e.message : e}`); throw e; }
  }
}

module.exports = { Progress, resolveLogsDir };
