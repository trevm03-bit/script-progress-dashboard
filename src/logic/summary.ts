// The summary strip: the handful of numbers worth seeing before anything else, and the text of
// the "Copy Daily Summary" command. Pure.
import { DashboardData, RunRecord, Settings } from '../types';
import { calendarRows, dueText } from './calendar';
import { Coverage, coverage } from './compliance';
import { healthRows } from './health';
import { outOfRange, formatMetric } from './sparkline';
import { formatDuration, parseIso, taskState } from './time';
import { failurePatterns, patternText } from './failures';

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

/**
 * The coverage figure, computed ONE way for every surface that shows it.
 *
 * 🔴 There were two implementations, and a comment in the second one saying they had to agree.
 * They did not. The emailed digest used a 7-day window against the dashboard's 30 (63% in the
 * email, 86% on screen, from the same data at the same instant), gave a full mark to metrics
 * that had never reported a value, and ignored `coverage.show` entirely - so "Copy Digest for
 * Email" pasted a coverage line the dashboard was deliberately not displaying. A comment
 * cannot keep two implementations in step; one implementation can.
 *
 * Returns null when coverage is switched off or there is no calendar to judge, which is
 * exactly the dashboard's own gate.
 */
export function coverageFor(
  data: DashboardData,
  settings: Settings,
  now: Date,
  opts: { historyCap?: number; facts?: SummaryFacts } = {},
): Coverage | null {
  if (!settings.coverage.show || !settings.processes.length) return null;
  // Only metrics that have actually reported. `metricsOutOfRange` can never name a metric
  // with no data, so counting thresholds instead gave a full mark to a metric that has never
  // been measured - the figure at its most confident about the thing it knows least about.
  const metricsTracked = Object.keys(settings.deltas.thresholds || {}).filter(name =>
    (Object.prototype.hasOwnProperty.call(data.deltas || {}, name) ? data.deltas[name] : []) ?.length).length;
  const facts = opts.facts ?? summaryFacts(data, settings, now);
  return coverage(calendarRows(settings.processes, data.history, now), data.history,
    facts.metricsOutOfRange.length, metricsTracked, now, 30, settings.coverage.weights,
    opts.historyCap ?? 100);
}

export function summaryFacts(data: DashboardData, settings: Settings, now: Date): SummaryFacts {
  const states = data.tasks.map(t => taskState(t, settings.staleRunningMinutes, now, data.overlays));
  const today = data.history.filter(r => isToday(r.date, now));
  const rows = calendarRows(settings.processes, data.history, now);
  const overdue = rows.filter(r => r.status === 'overdue').map(r => r.process.label || r.process.name);
  // 'unseen' is excluded for the same reason it is not counted as overdue: nothing has ever
  // reported it, so it has no meaningful next-due date — its nominal one is usually already in
  // the past, which made the strip announce "next: X — overdue" while the calendar said
  // "not wired yet". Two views of one fact must never disagree. The past-due guard is belt and
  // braces: no other status can produce one, and if that ever changes this still cannot lie.
  const upcoming = rows
    .filter(r => r.status !== 'overdue' && r.status !== 'unseen' && r.nextDue.getTime() >= now.getTime())
    .sort((a, b) => a.nextDue.getTime() - b.nextDue.getTime())[0];
  const health = settings.sections.scriptHealth ? healthRows(data.history, settings.staleHours, now, 0) : [];
  // 🔴 Per TASK, and via an own-property lookup.
  //
  // One metric name reported by two scripts is one series file and two lines on the chart.
  // Reading the single newest point across both let `Loader A` at 5000 hide `Loader B` at 5
  // against a min of 100: the strip showed a green "out of range: 0" tile and "1/1 metric(s)
  // in range" while the Delta Tracker card directly below it painted Loader B red and its
  // header read "1 out of range".
  //
  // And the key comes from user settings, so a plain [] index reaches the prototype:
  // data.deltas['constructor'] yields the Object constructor, whose .length is 1, so the
  // emptiness guard passed and the next line dereferenced a function - throwing out of the
  // render, which blanks the whole dashboard. processCalendar was hardened against exactly
  // this and its sibling here was left alone.
  const metricsOutOfRange: string[] = [];
  for (const [name, t] of Object.entries(settings.deltas.thresholds || {})) {
    const pts = Object.prototype.hasOwnProperty.call(data.deltas || {}, name) ? data.deltas[name] : undefined;
    if (!Array.isArray(pts) || !pts.length) continue;
    const latestPerTask = new Map<string, number>();
    for (const p of pts) if (p && typeof p.value === 'number') latestPerTask.set(p.task || '', p.value);
    if ([...latestPerTask.values()].some(v => outOfRange(v, t))) metricsOutOfRange.push(name);
  }
  // Not-in-the-future, so this agrees with "runs today" / "failed today", which use isToday().
  // A clock-skewed container writing tomorrow's date made the strip say "0 failed today" beside a
  // Last Completed card reading "FAILED - just now" for the same run.
  const lastRun = data.history
    .filter(r => (parseIso(r.date)?.getTime() ?? 0) <= now.getTime())
    .sort((a, b) => (parseIso(b.date)?.getTime() ?? 0) - (parseIso(a.date)?.getTime() ?? 0))[0] ?? null;
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

/**
 * A week's worth, for the kind of status note that goes to someone who was not watching.
 * Same shape as the daily summary, rolled up: what ran, what did not, what is overdue, how the
 * tracked metrics moved, and the failure pattern if there is one.
 */
const NL = '\n';

export function weeklyDigestText(data: DashboardData, settings: Settings, now: Date, days = 7): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const day = (d: Date) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
  const runs = data.history
    // Bounded at both ends. Without the upper bound a run dated in the future - a clock-skewed
    // container, a hand-edited file - was counted in "this week" and printed under Failures with
    // its own date next to a heading that says the week ended today.
    .filter(r => { const d = parseIso(r.date); return !!d && d >= from && d.getTime() <= now.getTime(); })
    .sort((a, b) => (parseIso(a.date)?.getTime() ?? 0) - (parseIso(b.date)?.getTime() ?? 0));

  const lines: string[] = [];
  lines.push(`Script Progress — week of ${day(from)} to ${day(now)}`);
  lines.push('');

  const failed = runs.filter(r => !r.success);
  const warnings = runs.reduce((n, r) => n + (r.warnings || 0), 0);
  lines.push(`${runs.length} run(s) · ${failed.length} failed · ${warnings} warning(s)`);
  lines.push('');

  // Per task: how often, how it went, how long it typically took.
  const byTask = new Map<string, RunRecord[]>();
  for (const r of runs) {
    const list = byTask.get(r.task);
    if (list) list.push(r); else byTask.set(r.task, [r]);
  }
  if (byTask.size) {
    lines.push('By script:');
    for (const [task, list] of Array.from(byTask.entries()).sort((a, b) => b[1].length - a[1].length)) {
      const bad = list.filter(r => !r.success).length;
      const avg = list.reduce((n, r) => n + (Number(r.elapsed) || 0), 0) / list.length;
      const warn = list.reduce((n, r) => n + (r.warnings || 0), 0);
      lines.push(`  ${task}: ${list.length} run(s)${bad ? `, ${bad} FAILED` : ''}${warn ? `, ${warn} warning(s)` : ''} · typically ${formatDuration(avg)}`);
    }
    lines.push('');
  }

  // Scripts the calendar expected but never saw this week.
  const rows = calendarRows(settings.processes, data.history, now);
  const overdue = rows.filter(r => r.status === 'overdue');
  const partial = rows.filter(r => r.status === 'partial');
  const unseen = rows.filter(r => r.status === 'unseen');
  if (settings.processes.length) {
    lines.push(`Calendar: ${overdue.length ? 'OVERDUE ' + overdue.map(r => r.process.label || r.process.name).join(', ') : 'nothing overdue'}`);
    for (const r of partial) lines.push(`  ${r.process.label || r.process.name}: ${r.note}`);
    if (unseen.length) lines.push(`  not wired yet: ${unseen.map(r => r.process.label || r.process.name).join(', ')}`);
    lines.push('');
  }

  // How the tracked numbers moved across the week.
  const moved: string[] = [];
  for (const name of settings.deltaMetrics) {
    const pts = (data.deltas[name] ?? []).filter(pt => { const d = parseIso(pt.date); return !!d && d >= from; });
    if (pts.length < 1) continue;
    const fmt = settings.deltas.formats?.[name];
    const first = pts[0].value, last = pts[pts.length - 1].value;
    const arrow = last > first ? 'up' : last < first ? 'down' : 'flat';
    moved.push(`  ${fmt?.label || name}: ${formatMetric(first, fmt)} -> ${formatMetric(last, fmt)} (${arrow})`);
  }
  if (moved.length) {
    lines.push('Tracked metrics:');
    lines.push(...moved);
    lines.push('');
  }

  if (failed.length) {
    lines.push('Failures:');
    for (const r of failed) {
      const d = parseIso(r.date);
      lines.push(`  ${d ? day(d) : ''} ${r.task}${r.category ? ` [${r.category}]` : ''}${r.summary ? ` — ${r.summary}` : ''}`);
    }
    const pattern = patternText(failurePatterns(data.history, now, days, 20));
    if (pattern) lines.push(`  Pattern: ${pattern}`);
    lines.push('');
  }

  const f = summaryFacts(data, settings, now);
  if (f.staleScripts.length) lines.push(`Stale scripts: ${f.staleScripts.join(', ')}`);
  if (f.metricsOutOfRange.length) lines.push(`Metrics out of range: ${f.metricsOutOfRange.join(', ')}`);
  return lines.join(NL).replace(new RegExp(`${NL}{3,}`, 'g'), NL + NL).trimEnd();
}

/** CSV of run history (RFC 4180 quoting). */
export function historyCsv(history: RunRecord[]): string {
  const q = (v: unknown) => {
    let s = v === undefined || v === null ? '' : String(v);
    // A leading = + - @ (or tab/CR) would be executed as a formula by spreadsheets; neutralise it.
    if (/^[=+\-@\t\r]/.test(s) && !(typeof v === 'number')) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = history
    .slice()
    .sort((a, b) => (parseIso(a.date)?.getTime() ?? 0) - (parseIso(b.date)?.getTime() ?? 0));
  const metricKeys = Array.from(new Set(rows.flatMap(r => Object.keys(r.metrics || {})))).sort();
  // The header goes through q() too. Metric names come from scripts, so one containing a comma
  // or a quote silently shifted every column after it - the file still opened, and every value
  // under it was attributed to the wrong field.
  const head = ['date', 'task', 'success', 'elapsed_seconds', 'warnings', 'summary', 'run_id', 'started_at', ...metricKeys];
  const out = [head.map(q).join(',')];
  for (const r of rows) {
    out.push([
      r.date, r.task, r.success ? 'true' : 'false', r.elapsed, r.warnings ?? 0, r.summary ?? '', r.runId ?? '', r.startedAt ?? '',
      ...metricKeys.map(k => (r.metrics && k in r.metrics ? r.metrics[k] : '')),
    ].map(q).join(','));
  }
  return out.join('\r\n') + '\r\n';
}
