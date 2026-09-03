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
