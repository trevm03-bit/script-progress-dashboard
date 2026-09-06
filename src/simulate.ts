// "Simulate a Demo Run": the extension itself plays a short job through the SAME file contract
// the reporters use, so an install can be verified with no Python or Node at all. It refuses to
// start while a real task is running, and writes only into the configured logs folder.
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DashboardData, ProgressData, RunRecord, AccessGraph, DeltaSeries } from './types';
import { slug, taskState } from './logic/time';

const STEPS: [string, ('file' | 'table' | 'api') | null, string, 'read' | 'write'][] = [
  ['Reading input file', 'file', 'input/orders.csv', 'read'],
  ['Validating rows', null, '', 'read'],
  ['Looking up customers', 'table', 'crm.customers', 'read'],
  ['Joining products', 'table', 'catalog.products', 'read'],
  ['Calculating totals', null, '', 'read'],
  ['Writing warehouse table', 'table', 'sales.orders_monthly', 'write'],
  ['Posting summary', 'api', 'Reporting service', 'write'],
];

function iso(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Read one of the log files, or fall back — and REFUSE to fall back over data we simply could not
 * parse.
 *
 * 🔴 The fourth instance of one bug. `catch { return def; }` reads "unreadable" as "empty", and
 * every caller here writes the result straight back: a run_history.json carrying a UTF-8 BOM —
 * which is what PowerShell's `Set-Content -Encoding utf8` and Notepad produce, and which the
 * dashboard renders perfectly because DataReader strips one — was replaced by the single
 * simulated run. Forty real runs became one, from a menu command whose whole purpose is to be
 * safe to click. The same shape was fixed in the Python reporter, the Node reporter and Import
 * Delta History; this is the copy the review's own reproduction rule could not reach, because it
 * needs a `vscode` stub to load at all.
 *
 * A missing file is genuinely empty. A file that exists and will not parse is not.
 */
class UnreadableLogFile extends Error {}

function readJson<T>(file: string, def: T): T {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf-8');
  } catch {
    return def;                       // not there yet: an empty default is the truth
  }
  try {
    return JSON.parse(raw.replace(/^\uFEFF/, '')) as T;
  } catch (e) {
    throw new UnreadableLogFile(`${path.basename(file)} could not be read (${(e as Error).message})`);
  }
}

function writeJson(file: string, data: unknown): void {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
}

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export async function simulateRun(logsDir: string, current: DashboardData, staleMinutes: number, mode: 'ok' | 'fail' = 'ok'): Promise<void> {
  const now = new Date();
  const busy = current.tasks.find(t => taskState(t, staleMinutes, now, current.overlays) === 'running');
  if (busy) {
    void vscode.window.showWarningMessage(`Script Progress: "${busy.task}" is running — the demo will not write over a real run.`);
    return;
  }
  fs.mkdirSync(path.join(logsDir, 'progress'), { recursive: true });
  const task = 'Demo Pipeline (simulated)';
  const runId = `${iso().replace(/[-:T]/g, '').slice(0, 15)}-demo`;
  const startedAt = iso();
  const start = Date.now();
  const warnings: { time: string; msg: string }[] = [];
  const log: { time: string; msg: string }[] = [];
  const accessed: string[] = [];
  const metrics: Record<string, number | string> = {};
  const rnd = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));

  const write = (status: ProgressData['status'], step: number, label: string, detail: string, substep: number | null) => {
    const data: ProgressData = {
      task, status, step, totalSteps: STEPS.length, label, detail, substep,
      elapsed: Math.round((Date.now() - start) / 100) / 10, eta: status === 'running' ? Math.max(0, Math.round((STEPS.length - step) * 0.9)) : null,
      warnings: warnings.slice(-10), log: log.slice(-20), metrics, artifacts: [], accessed, runId, startedAt, updatedAt: iso(),
    };
    writeJson(path.join(logsDir, 'progress.json'), data);
    writeJson(path.join(logsDir, 'progress', `${slug(task)}.json`), data);
  };
  const access = (kind: 'file' | 'table' | 'api', name: string, mode: 'read' | 'write') => {
    const file = path.join(logsDir, 'access.json');
    const g = readJson<AccessGraph>(file, { nodes: [], edges: [] });
    const nodes = new Map((g.nodes || []).map(n => [n.id, n]));
    const tid = `task:${task}`, rid = `${kind}:${name}`, t = iso();
    nodes.set(tid, { id: tid, type: 'task', label: task, lastSeen: t });
    nodes.set(rid, { id: rid, type: kind, label: name, lastSeen: t });
    const edges = g.edges || [];
    const e = edges.find(x => x.from === tid && x.to === rid && x.mode === mode);
    if (e) { e.count++; e.lastSeen = t; } else edges.push({ from: tid, to: rid, mode, count: 1, lastSeen: t });
    writeJson(file, { nodes: [...nodes.values()], edges });
    if (!accessed.includes(rid)) accessed.push(rid);
  };

  write('running', 0, 'Starting', '', null);
  log.push({ time: iso(), msg: 'simulated by the extension — no script involved' });
  for (let i = 0; i < STEPS.length; i++) {
    const [label, kind, name, mode] = STEPS[i];
    write('running', i + 1, label, '', null);
    if (kind) access(kind, name, mode);
    for (let f = 1; f <= 4; f++) { await sleep(180); write('running', i + 1, label, '', f / 4); }
    const rows = rnd(1000, 5000);
    write('running', i + 1, label, `${rows.toLocaleString('en-US')} rows`, null);
    if (i === 2) warnings.push({ time: iso(), msg: `${rnd(3, 40)} rows had no customer id` });
    if (i === 4) { warnings.push({ time: iso(), msg: 'Totals differ from prior month by more than 20%' }); metrics.rows_loaded = rnd(3800, 4200); }
    log.push({ time: iso(), msg: `${label.toLowerCase()} done` });
    await sleep(160);
  }
  metrics.total_value = `$${(10 + Math.random() * 10).toFixed(1)}M`;

  const deltasFile = path.join(logsDir, 'deltas.json');
  const deltas = readJson<DeltaSeries>(deltasFile, {});
  (deltas.rows_loaded = deltas.rows_loaded || []).push({ date: iso(), value: Number(metrics.rows_loaded), task });
  (deltas.reconciliation_delta = deltas.reconciliation_delta || []).push({ date: iso(), value: Math.round((Math.random() - 0.5) * 100) / 100, task });
  for (const k of Object.keys(deltas)) deltas[k] = deltas[k].slice(-50);
  writeJson(deltasFile, deltas);

  const ok = mode === 'ok';
  const summary = ok ? `INSERT: ${Number(metrics.rows_loaded).toLocaleString('en-US')} rows | total ${metrics.total_value}` : 'Row count mismatch: expected 4,013 got 3,977';
  write(ok ? 'complete' : 'failed', STEPS.length, ok ? 'Complete' : 'FAILED', summary, null);
  const histFile = path.join(logsDir, 'run_history.json');
  const hist = readJson<RunRecord[]>(histFile, []);
  hist.push({ task, date: iso(), success: ok, elapsed: Math.round((Date.now() - start) / 100) / 10, summary, warnings: warnings.length, runId, startedAt, metrics, warningItems: warnings, accessed, artifacts: [] });
  writeJson(histFile, hist.slice(-100));
}
