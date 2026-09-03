// The summary strip: the handful of numbers worth seeing before anything else, and the text of
// the "Copy Daily Summary" command. Pure.
import { DashboardData, RunRecord, Settings } from '../types';
import { calendarRows, dueText } from './calendar';
import { healthRows } from './health';
import { outOfRange, formatMetric } from './sparkline';
import { formatDuration, parseIso, taskState } from './time';

export interface SummaryFacts {
  runningCount: number;
  stalledCount: number;
  runsToday: number;
  failedToday: number;
  warningsToday: number;
  /** Calendar processes overdue right now. */
  overdue: string[];
  /** The soonest upcoming process, if any. */
  nextDue: { label: string; text: string } | null;
  staleScripts: string[];
  metricsOutOfRange: string[];
  lastRun: RunRecord | null;
}

function isToday(iso: string, now: Date): boolean {
  const d = parseIso(iso);
  return !!d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export function summaryFacts(data: DashboardData, settings: Settings, now: Date): SummaryFacts {
  const states = data.tasks.map(t => taskState(t, settings.staleRunningMinutes, now));
  const today = data.history.filter(r => isToday(r.date, now));
  const rows = calendarRows(settings.processes, data.history, now);
  const overdue = rows.filter(r => r.status === 'overdue').map(r => r.process.label || r.process.name);
  const upcoming = rows
    .filter(r => r.status !== 'overdue')
    .sort((a, b) => a.nextDue.getTime() - b.nextDue.getTime())[0];
  const health = settings.sections.scriptHealth ? healthRows(data.history, settings.staleHours, now, 0) : [];
  const metricsOutOfRange: string[] = [];
  for (const [name, t] of Object.entries(settings.deltas.thresholds || {})) {
    const pts = data.deltas[name];
    if (!pts || !pts.length) continue;
    if (outOfRange(pts[pts.length - 1].value, t)) metricsOutOfRange.push(name);
  }
  const lastRun = data.history.slice().sort((a, b) => (parseIso(b.date)?.getTime() ?? 0) - (parseIso(a.date)?.getTime() ?? 0))[0] ?? null;
  return {
    runningCount: states.filter(s => s === 'running').length,
    stalledCount: states.filter(s => s === 'stalled' || s === 'exited').length,
    runsToday: today.length,
    failedToday: today.filter(r => !r.success).length,
    warningsToday: today.reduce((n, r) => n + (r.warnings || 0), 0),
    overdue,
    nextDue: upcoming ? { label: upcoming.process.label || upcoming.process.name, text: dueText(upcoming.nextDue, now) } : null,
    staleScripts: health.filter(h => h.freshness === 'stale').map(h => h.task),
    metricsOutOfRange,
    lastRun,
  };
}

/** Plain text for a standup / status message. */
export function dailySummaryText(data: DashboardData, settings: Settings, now: Date): string {
  const f = summaryFacts(data, settings, now);
  const p = (n: number) => String(n).padStart(2, '0');
  const lines: string[] = [];
  lines.push(`Script Progress — ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`);
  lines.push('');
  lines.push(`Runs today: ${f.runsToday} (${f.failedToday} failed, ${f.warningsToday} warnings)`);
  if (f.runningCount) lines.push(`Running now: ${f.runningCount}`);
  if (f.stalledCount) lines.push(`Stalled / exited: ${f.stalledCount}`);
  const today = data.history
    .filter(r => isToday(r.date, now))
    .sort((a, b) => (parseIso(a.date)?.getTime() ?? 0) - (parseIso(b.date)?.getTime() ?? 0));
  for (const r of today) {
    const d = parseIso(r.date);
    const t = d ? `${p(d.getHours())}:${p(d.getMinutes())}` : '';
    const metrics = r.metrics ? Object.entries(r.metrics).map(([k, v]) => `${k}=${typeof v === 'number' ? formatMetric(v) : v}`).join(', ') : '';
    lines.push(`  ${r.success ? 'OK  ' : 'FAIL'} ${t} ${r.task} · ${formatDuration(r.elapsed)}${r.warnings ? ` · ${r.warnings} warning(s)` : ''}${r.summary ? ` · ${r.summary}` : ''}${metrics ? ` · ${metrics}` : ''}`);
  }
  if (settings.processes.length) {
    lines.push('');
    lines.push(`Calendar: ${f.overdue.length ? 'OVERDUE ' + f.overdue.join(', ') : 'nothing overdue'}${f.nextDue ? ` · next: ${f.nextDue.label} ${f.nextDue.text}` : ''}`);
  }
  if (f.staleScripts.length) lines.push(`Stale scripts: ${f.staleScripts.join(', ')}`);
  if (f.metricsOutOfRange.length) lines.push(`Metrics out of range: ${f.metricsOutOfRange.join(', ')}`);
  return lines.join('\n');
}

/** CSV of run history (RFC 4180 quoting). */
export function historyCsv(history: RunRecord[]): string {
  const q = (v: unknown) => {
    const s = v === undefined || v === null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = history
    .slice()
    .sort((a, b) => (parseIso(a.date)?.getTime() ?? 0) - (parseIso(b.date)?.getTime() ?? 0));
  const metricKeys = Array.from(new Set(rows.flatMap(r => Object.keys(r.metrics || {})))).sort();
  const head = ['date', 'task', 'success', 'elapsed_seconds', 'warnings', 'summary', 'run_id', 'started_at', ...metricKeys];
  const out = [head.join(',')];
  for (const r of rows) {
    out.push([
      r.date, r.task, r.success ? 'true' : 'false', r.elapsed, r.warnings ?? 0, r.summary ?? '', r.runId ?? '', r.startedAt ?? '',
      ...metricKeys.map(k => (r.metrics && k in r.metrics ? r.metrics[k] : '')),
    ].map(q).join(','));
  }
  return out.join('\r\n') + '\r\n';
}
