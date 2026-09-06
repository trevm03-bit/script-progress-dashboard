// Reliability over time, cumulative contribution, and the things still waiting to be done. PURE.
//
// These three answer the questions that come after "did it run today?": has it been running
// reliably, what has it added up to, and what is outstanding. Each is DERIVED from run history —
// nothing here is stored, so nothing here can drift out of step with what actually happened.
import { ProcessConfig, RunRecord, Warning } from '../types';
import { matchesProcess, periodStart } from './calendar';
import { parseIso } from './time';

// ---------------------------------------------------------------- SLA compliance

export interface PeriodResult {
  /** Label for the period: "Sep 2026", "wk of 8 Sep", "8 Sep". */
  label: string;
  start: Date;
  end: Date;
  /** A successful run happened in this period. */
  met: boolean;
  /** Periods before the first run ever are unknown, not missed. */
  known: boolean;
  runs: number;
}

export interface ComplianceReport {
  process: ProcessConfig;
  periods: PeriodResult[];
  /** Periods met / periods that could have been met. */
  met: number;
  of: number;
  /** 0–100, or null when there is nothing to judge yet. */
  percent: number | null;
  /** Consecutive most-recent periods met, ending at the last COMPLETE period. */
  streak: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Did this process run in each of the last `count` periods?
 *
 * The current period is excluded: it is not over, so counting it as missed would drag every
 * figure down for reasons that are not yet true. Periods before the process ever ran are marked
 * `known: false` and left out of the percentage — a process wired up last week is not "0% for
 * the year", it simply has no history, and pretending otherwise makes the number useless.
 */
export function complianceReport(process: ProcessConfig, history: RunRecord[], now: Date, count = 12): ComplianceReport {
  // 🔴 `firstEver` comes from EVERY matching run, not just the successful ones. Filtering to
  // successes first meant a process that ran and FAILED in Jan-Jun and only succeeded in
  // Jul-Aug had firstEver = July, so the six failed months were marked "before it was wired"
  // and left out of the percentage. The row rendered a green 100% with six grey dots whose
  // tooltip read "Jan 26: before it was wired" for months whose failures were sitting in Run
  // History on the same screen. `met` still requires success; only the ORIGIN date changes.
  const attempts = history
    .filter(r => matchesProcess(r.task, process))
    .map(r => ({ r, d: parseIso(r.date) }))
    .filter((x): x is { r: RunRecord; d: Date } => !!x.d)
    .sort((a, b) => a.d.getTime() - b.d.getTime());
  const runs = attempts.filter(x => x.r.success);
  const firstEver = attempts[0]?.d ?? null;

  const periods: PeriodResult[] = [];
  for (let i = count; i >= 1; i--) {
    const { start, end, label } = periodBounds(process, now, i);
    const inPeriod = runs.filter(x => x.d >= start && x.d < end);
    periods.push({
      label, start, end,
      met: inPeriod.length > 0,
      known: !!firstEver && firstEver < end,
      runs: inPeriod.length,
    });
  }

  const judged = periods.filter(p => p.known);
  const met = judged.filter(p => p.met).length;
  let streak = 0;
  for (let i = periods.length - 1; i >= 0; i--) {
    if (!periods[i].known) break;
    if (!periods[i].met) break;
    streak++;
  }
  return {
    process, periods,
    met, of: judged.length,
    percent: judged.length ? Math.round((met / judged.length) * 100) : null,
    streak,
  };
}

/** Start/end of the period `back` steps before the current one (1 = the last complete period). */
function periodBounds(process: ProcessConfig, now: Date, back: number): { start: Date; end: Date; label: string } {
  const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  switch (process.frequency) {
    case 'daily': {
      const start = new Date(y, m, d - back);
      const end = new Date(y, m, d - back + 1);
      return { start, end, label: `${start.getDate()} ${MONTHS[start.getMonth()]}` };
    }
    case 'weekly': {
      const monday = startOfWeek(now);
      const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * back);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
      return { start, end, label: `wk ${start.getDate()} ${MONTHS[start.getMonth()]}` };
    }
    case 'monthly':
    default: {
      const start = new Date(y, m - back, 1);
      const end = new Date(y, m - back + 1, 1);
      return { start, end, label: `${MONTHS[start.getMonth()]} ${String(start.getFullYear()).slice(2)}` };
    }
  }
}

function startOfWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = out.getDay();
  out.setDate(out.getDate() - (day === 0 ? 6 : day - 1));
  return out;
}

// ---------------------------------------------------------------- cumulative impact

export interface ImpactTotal {
  metric: string;
  label: string;
  total: number;
  runs: number;
  first: string;
  last: string;
  /** Total within the current calendar month. */
  thisMonth: number;
}

/**
 * Sum what runs have contributed, per metric. Newest activity first.
 *
 * `history` is optional but should always be passed: `impact()` writes the moment it is called,
 * so a run that crashes afterwards has still contributed to the file. Counting it would let a
 * failed run inflate the headline — the same mistake Pending Actions deliberately avoids.
 */
export function impactTotals(
  impact: Record<string, { date: string; value: number; task: string; label?: string; runId?: string }[]>,
  now: Date,
  history: RunRecord[] = [],
): ImpactTotal[] {
  const out: ImpactTotal[] = [];
  const failedRuns = new Set(history.filter(r => !r.success && r.runId).map(r => r.runId as string));
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  for (const [metric, points] of Object.entries(impact || {})) {
    if (!Array.isArray(points) || !points.length) continue;
    const valid = points.filter(p =>
      p && typeof p.value === 'number' && isFinite(p.value) && !(p.runId && failedRuns.has(p.runId)));
    if (!valid.length) continue;
    const runIds = new Set(valid.map(p => (p as { runId?: string }).runId ?? p.date));
    out.push({
      metric,
      label: valid.find(p => p.label)?.label || metric,
      total: round(valid.reduce((n, p) => n + p.value, 0)),
      runs: runIds.size,
      first: valid[0].date,
      last: valid[valid.length - 1].date,
      thisMonth: round(valid.filter(p => { const d = parseIso(p.date); return !!d && d >= monthStart; }).reduce((n, p) => n + p.value, 0)),
    });
  }
  return out.sort((a, b) => (parseIso(b.last)?.getTime() ?? 0) - (parseIso(a.last)?.getTime() ?? 0));
}

// ---------------------------------------------------------------- pending actions

export interface PendingAction extends Warning {
  task: string;
  /** The run that most recently reported it. */
  runId?: string;
  date: string;
}

/**
 * Warnings a script marked `actionable`, from each task's most recent SUCCESSFUL run.
 *
 * Derived, never stored — which is the whole point. An item disappears exactly when a later
 * successful run of that task stops reporting it, and no earlier. 🔴 A run that FAILED cannot
 * clear anything: it may have died before reaching the check, and treating "did not mention it"
 * as "dealt with" would quietly retire real findings. Absence of evidence, in a run that
 * crashed, is not evidence of absence.
 */
export function pendingActions(history: RunRecord[], now: Date, maxAgeDays = 90): PendingAction[] {
  const cutoff = now.getTime() - maxAgeDays * 86400000;
  const latestSuccessByTask = new Map<string, RunRecord>();
  for (const r of history) {
    if (!r.success) continue;
    const d = parseIso(r.date)?.getTime() ?? 0;
    if (d < cutoff) continue;
    const cur = latestSuccessByTask.get(r.task);
    // >= not >: timestamps are second-resolution, so two runs of one task can share one. History
    // is append-ordered oldest-first, so on a tie the later entry is the newer run — and picking
    // the older one would leave an item outstanding that the newer run had already cleared.
    if (!cur || d >= (parseIso(cur.date)?.getTime() ?? 0)) latestSuccessByTask.set(r.task, r);
  }
  const out: PendingAction[] = [];
  for (const [task, run] of latestSuccessByTask) {
    // isRun() only guarantees task and date are strings; every other field comes from a file
    // any process can write. A renderer that throws blanks the dashboard, and this section is
    // on by default, so the guard belongs here rather than in the caller.
    if (!Array.isArray(run.warningItems)) continue;
    for (const w of run.warningItems) {
      if (!w || typeof w !== 'object' || !w.actionable) continue;
      out.push({ ...w, task, runId: run.runId, date: run.date });
    }
  }
  return out.sort((a, b) => (parseIso(b.date)?.getTime() ?? 0) - (parseIso(a.date)?.getTime() ?? 0));
}

// ---------------------------------------------------------------- coverage & compliance

export interface CoverageInput {
  label: string;
  /** 0–1. */
  score: number;
  /** What the number is, in words — always shown next to it. */
  detail: string;
  weight: number;
}

export interface Coverage {
  /** 0–100, or null when there is nothing to measure. */
  percent: number | null;
  inputs: CoverageInput[];
}

/**
 * A single figure for "is the routine holding together", with its inputs always beside it.
 *
 * 🔴 This is deliberately NOT called a data-quality score. This extension can see whether jobs
 * ran, whether they succeeded, and how the numbers they report about themselves moved. It cannot
 * see the data. A composite is honest when the reader can check what went into it and the name
 * claims no more than the inputs support; it stops being honest the moment it implies the tool
 * inspected the data itself. Never rename this to something it cannot substantiate.
 */
export interface CoverageWeights { schedule: number; success: number; metrics: number }
export const DEFAULT_COVERAGE_WEIGHTS: CoverageWeights = { schedule: 2, success: 2, metrics: 1 };

export function coverage(
  calendar: { status: string; phases?: { done: boolean }[] }[],
  history: RunRecord[],
  metricsOutOfRange: number,
  metricsTracked: number,
  now: Date,
  days = 30,
  weights: CoverageWeights = DEFAULT_COVERAGE_WEIGHTS,
  historyCap = 0,
): Coverage {
  const inputs: CoverageInput[] = [];
  const cutoff = now.getTime() - days * 86400000;
  // Upper bound as well as lower: a run dated years out is not evidence about the last 30 days.
  const recent = history.filter(r => {
    const t = parseIso(r.date)?.getTime() ?? 0;
    return t >= cutoff && t <= now.getTime();
  });

  // 1. Schedule adherence. 'blocked' and 'unseen' are excluded — neither is this process failing
  //    to comply. 🔴 'pending' is excluded too, and that matters: it means "not run and NOT YET
  //    DUE", so counting it as on time made every monthly process score full marks on the 1st and
  //    the figure was highest exactly when the tool knew least. 'partial' scores the fraction of
  //    its phases that are done, because that is what it is.
  const judged = calendar.filter(r => r.status !== 'unseen' && r.status !== 'blocked' && r.status !== 'pending');
  if (judged.length) {
    const score = judged.reduce((n, r) => {
      if (r.status === 'done') return n + 1;
      if (r.status === 'partial' && r.phases?.length) return n + r.phases.filter(p => p.done).length / r.phases.length;
      return n;
    }, 0);
    const pending = calendar.filter(r => r.status === 'pending').length;
    inputs.push({
      label: 'On schedule', score: score / judged.length, weight: weights.schedule,
      detail: `${round1(score)}/${judged.length} due process(es) on schedule${pending ? ` · ${pending} not due yet` : ''}`,
    });
  }
  // 2. Did runs succeed?
  if (recent.length) {
    const ok = recent.filter(r => r.success).length;
    // History is capped, so past that cap the denominator is the cap and not the window. Say so
    // rather than claiming a window the data cannot cover.
    // 🔴 Truncated WINDOW, not full file. `history.length >= historyCap` says nothing about
    // whether the 30-day window is complete: with 100 rows spanning 200 days every run in the
    // last 30 is present and the figure is exact, yet the note told the reader it was
    // truncated - permanently, for any long-lived install. The window is only short if the
    // file is full AND its oldest row is newer than the cutoff.
    const oldest = history.reduce((min, r) => Math.min(min, parseIso(r.date)?.getTime() ?? Infinity), Infinity);
    const capped = historyCap > 0 && history.length >= historyCap && oldest > cutoff;
    inputs.push({
      label: 'Runs succeeded', score: ok / recent.length, weight: weights.success,
      // Say what the denominator ACTUALLY is. "5/7 of the last 100 runs" was arithmetic nonsense:
      // 7 is the window count, 100 is the file cap. When the file is full, the window is only as
      // deep as the file allows, so name that instead of inventing a third number.
      detail: capped
        ? `${ok}/${recent.length} run(s) in ${days} days (history is full at ${historyCap}, so older runs are not counted)`
        : `${ok}/${recent.length} run(s) in ${days} days`,
    });
  }
  // 3. Are the tracked numbers inside their thresholds?
  if (metricsTracked > 0) {
    inputs.push({
      label: 'Metrics in range', score: (metricsTracked - metricsOutOfRange) / metricsTracked, weight: weights.metrics,
      detail: `${metricsTracked - metricsOutOfRange}/${metricsTracked} metric(s) in range`,
    });
  }
  // 🔴 At least one OBSERVED input. With no runs and no due processes, the only surviving input
  // is "metrics in range", and a lone threshold would put a green 100% at the top of the page for
  // a routine that has never run — the figure at its most confident when it knows nothing.
  const observed = inputs.some(i => i.label === 'On schedule' || i.label === 'Runs succeeded');
  if (!inputs.length || !observed) return { percent: null, inputs };
  // Weights are user-settable and may all be zero. Dividing by that produced NaN, which passed
  // the caller's `!== null` guard and rendered as "NaN%".
  const total = inputs.reduce((n, i) => n + i.weight, 0);
  if (!(total > 0)) return { percent: null, inputs };
  const score = inputs.reduce((n, i) => n + clamp01(i.score) * i.weight, 0) / total;
  return { percent: Number.isFinite(score) ? Math.round(score * 100) : null, inputs };
}

function clamp01(n: number): number { return Math.max(0, Math.min(1, isFinite(n) ? n : 0)); }
function round1(n: number): number { return Math.round(n * 10) / 10; }
function round(n: number): number { return Math.round(n * 100) / 100; }
