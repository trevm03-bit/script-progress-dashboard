// Duration anomalies and SLA checks. Pure.
import { ProcessConfig, RunRecord } from '../types';
import { matchesProcess } from './calendar';
import { parseIso } from './time';

export interface DurationVerdict {
  /** Multiple of the task's typical (median) successful duration, e.g. 2.3. */
  factor: number;
  /** Median of prior successful durations the verdict was measured against. */
  baseline: number;
  /** How many prior runs the baseline used. */
  sample: number;
  slow: boolean;
}

function median(values: number[]): number {
  const v = values.slice().sort((a, b) => a - b);
  if (!v.length) return 0;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Compare one run's duration with the median of the task's other successful runs before it.
 * Needs at least 3 prior runs to say anything; below that factor = 1 and slow = false.
 */
export function durationVerdict(run: RunRecord, history: RunRecord[], factor = 2): DurationVerdict {
  const t = parseIso(run.date)?.getTime() ?? 0;
  const prior = history
    .filter(r => r !== run && r.task === run.task && r.success && typeof r.elapsed === 'number' && (parseIso(r.date)?.getTime() ?? 0) < t)
    .map(r => r.elapsed)
    .slice(-20);
  if (prior.length < 3 || !(run.elapsed > 0)) return { factor: 1, baseline: median(prior), sample: prior.length, slow: false };
  const baseline = median(prior);
  const f = baseline > 0 ? run.elapsed / baseline : 1;
  return { factor: f, baseline, sample: prior.length, slow: f >= factor && run.elapsed - baseline >= 5 };
}

/** The SLA (maxMinutes) that applies to a task, from the first matching process. */
export function slaFor(task: string, processes: ProcessConfig[]): number | undefined {
  const p = processes.find(x => typeof x.maxMinutes === 'number' && x.maxMinutes > 0 && matchesProcess(task, x));
  return p?.maxMinutes;
}

/** true when a run (or a running task's live elapsed) exceeds its SLA. */
export function overSla(task: string, elapsedSeconds: number, processes: ProcessConfig[]): boolean {
  const max = slaFor(task, processes);
  return typeof max === 'number' && elapsedSeconds > max * 60;
}

/** Change between two runs' metrics of the same task, for the detail row and the explorer. */
export interface MetricChange { key: string; value: number | string; previous: number | string | undefined; delta: number | null; pct: number | null }

export function metricChanges(run: RunRecord, previous: RunRecord | undefined): MetricChange[] {
  const out: MetricChange[] = [];
  for (const [key, value] of Object.entries(run.metrics || {})) {
    const prev = previous?.metrics?.[key];
    let delta: number | null = null;
    let pct: number | null = null;
    if (typeof value === 'number' && typeof prev === 'number' && isFinite(value) && isFinite(prev)) {
      delta = value - prev;
      pct = prev !== 0 ? (delta / Math.abs(prev)) * 100 : null;
    }
    out.push({ key, value, previous: prev, delta, pct });
  }
  return out;
}

/** The previous run of the same task before this one, if any. */
export function previousRun(run: RunRecord, history: RunRecord[]): RunRecord | undefined {
  const t = parseIso(run.date)?.getTime() ?? 0;
  return history
    .filter(r => r !== run && r.task === run.task && (parseIso(r.date)?.getTime() ?? 0) < t)
    .sort((a, b) => (parseIso(b.date)?.getTime() ?? 0) - (parseIso(a.date)?.getTime() ?? 0))[0];
}

/** A metric that moved far enough from its own history to be worth a second look. */
export interface MetricVerdict {
  key: string;
  value: number;
  baseline: number;
  /** value / baseline, or 0 when the baseline is 0 and the value is not. */
  factor: number;
  direction: 'up' | 'down';
  sample: number;
}

/**
 * Metrics in `run` that are far from their own median across this task's previous runs.
 *
 * Duration anomalies catch infrastructure; THESE catch data. A row count that falls from 3,990
 * to 200, or an issue count that jumps from 311 to 500, is the kind of thing that never fails a
 * run and is exactly what someone needed to know.
 *
 * Requires at least `minSample` prior successful runs, because two data points have no
 * meaningful median and a detector that fires on thin evidence is one that gets switched off.
 * `ignore` holds metric names that are expected to vary (a timestamp, an id, a naturally noisy
 * count) — without it, one restless number trains the reader to ignore all of them.
 */
export function metricAnomalies(
  run: RunRecord,
  history: RunRecord[],
  factor = 2,
  ignore: string[] = [],
  minSample = 4,
): MetricVerdict[] {
  const metrics = run.metrics;
  if (!metrics) return [];
  const skip = new Set(ignore.map(s => s.toLowerCase()));
  const t = parseIso(run.date)?.getTime() ?? 0;
  const prior = history.filter(r =>
    r !== run && r.task === run.task && r.success && (parseIso(r.date)?.getTime() ?? 0) < t);
  const out: MetricVerdict[] = [];
  for (const [key, raw] of Object.entries(metrics)) {
    if (skip.has(key.toLowerCase()) || typeof raw !== 'number' || !isFinite(raw)) continue;
    const series = prior
      .map(r => r.metrics?.[key])
      .filter((v): v is number => typeof v === 'number' && isFinite(v))
      .slice(-20);
    if (series.length < minSample) continue;
    const baseline = median(series);
    // A baseline of zero has no ratio. Only a move AWAY from zero is notable; staying at zero is
    // the most normal thing a zero-valued metric can do.
    if (baseline === 0) {
      if (raw !== 0) out.push({ key, value: raw, baseline, factor: 0, direction: raw > 0 ? 'up' : 'down', sample: series.length });
      continue;
    }
    // 🔴 Compare MAGNITUDES, and read the direction from the values themselves. Dividing signed
    // numbers inverted everything for a negative baseline: a metric going from -100 to -1000 (ten
    // times worse) reported "down", and -100 to 0 (a collapse) was not reported at all, because
    // the ratio maths only ever made sense for positive medians. A variance, a net delta or a
    // balance change is naturally negative, and those are exactly the numbers worth watching.
    const ratio = Math.abs(raw) / Math.abs(baseline);
    const flipped = (raw > 0 && baseline < 0) || (raw < 0 && baseline > 0);
    const direction: 'up' | 'down' = raw > baseline ? 'up' : 'down';
    if (flipped || ratio >= factor || ratio <= 1 / factor) {
      out.push({ key, value: raw, baseline, factor: ratio, direction, sample: series.length });
    }
  }
  return out;
}
