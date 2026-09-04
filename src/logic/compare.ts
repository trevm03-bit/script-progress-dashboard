// Comparing two runs of the same thing. PURE.
//
// "Did it run?" is answered by every other section. For a script whose output IS the finding —
// a reconciliation, a data-quality check — the question that actually follows is "and how does
// that compare to last time?". Everything needed is already in run history; this only arranges it.
import { RunRecord } from '../types';
import { parseIso } from './time';

export type Direction = 'up' | 'down' | 'same' | 'new' | 'gone';

export interface MetricDiff {
  key: string;
  a: number | string | undefined;
  b: number | string | undefined;
  /** b − a, when both are numbers. */
  delta: number | null;
  /** Percent change, when a is a non-zero number. */
  pct: number | null;
  direction: Direction;
}

export interface WarningDiff {
  /** Warnings present in b but not a. */
  added: string[];
  /** Warnings present in a but not b. */
  resolved: string[];
  /** Present in both. */
  unchanged: string[];
}

export interface RunComparison {
  a: RunRecord;
  b: RunRecord;
  /** True when b is the newer of the two (the usual reading direction). */
  bIsNewer: boolean;
  sameTask: boolean;
  metrics: MetricDiff[];
  warnings: WarningDiff;
  /** Seconds; b − a. */
  durationDelta: number;
  durationPct: number | null;
  outcomeChanged: boolean;
  touchedAdded: string[];
  touchedRemoved: string[];
}

/**
 * Compare run `a` (the baseline) with run `b`. Order is respected exactly as given — the caller
 * decides which is the baseline — but `bIsNewer` records what the dates say, so a UI can warn
 * when someone compares backwards without silently reordering their choice for them.
 */
export function compareRuns(a: RunRecord, b: RunRecord): RunComparison {
  const ta = parseIso(a.date)?.getTime() ?? 0;
  const tb = parseIso(b.date)?.getTime() ?? 0;
  const keys = Array.from(new Set([...Object.keys(a.metrics ?? {}), ...Object.keys(b.metrics ?? {})])).sort();
  const metrics: MetricDiff[] = keys.map(key => {
    const va = a.metrics?.[key];
    const vb = b.metrics?.[key];
    let delta: number | null = null;
    let pct: number | null = null;
    let direction: Direction;
    if (va === undefined) direction = 'new';
    else if (vb === undefined) direction = 'gone';
    else if (typeof va === 'number' && typeof vb === 'number') {
      delta = vb - va;
      pct = va !== 0 ? (delta / Math.abs(va)) * 100 : null;
      direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'same';
    } else {
      direction = String(va) === String(vb) ? 'same' : 'up';
    }
    return { key, a: va, b: vb, delta, pct, direction };
  });

  const wa = messages(a);
  const wb = messages(b);
  const setA = new Set(wa);
  const setB = new Set(wb);
  const warnings: WarningDiff = {
    added: wb.filter(m => !setA.has(m)),
    resolved: wa.filter(m => !setB.has(m)),
    unchanged: wb.filter(m => setA.has(m)),
  };

  const ea = Number(a.elapsed) || 0;
  const eb = Number(b.elapsed) || 0;
  const touchedA = new Set(a.accessed ?? []);
  const touchedB = new Set(b.accessed ?? []);

  return {
    a, b,
    bIsNewer: tb >= ta,
    sameTask: (a.task || '').toLowerCase() === (b.task || '').toLowerCase(),
    metrics,
    warnings,
    durationDelta: Math.round((eb - ea) * 10) / 10,
    durationPct: ea > 0 ? ((eb - ea) / ea) * 100 : null,
    outcomeChanged: !!a.success !== !!b.success,
    touchedAdded: (b.accessed ?? []).filter(id => !touchedA.has(id)),
    touchedRemoved: (a.accessed ?? []).filter(id => !touchedB.has(id)),
  };
}

/**
 * The run to compare against by default: the previous run of the same task. Falls back to the
 * previous run of anything only when the task has no earlier run, because comparing two
 * different scripts is rarely what anyone means.
 */
export function defaultBaseline(run: RunRecord, history: RunRecord[]): RunRecord | null {
  const t = parseIso(run.date)?.getTime() ?? 0;
  const earlier = history
    .filter(r => r !== run && (parseIso(r.date)?.getTime() ?? 0) < t)
    .sort((x, y) => (parseIso(y.date)?.getTime() ?? 0) - (parseIso(x.date)?.getTime() ?? 0));
  return earlier.find(r => (r.task || '').toLowerCase() === (run.task || '').toLowerCase()) ?? null;
}

/** Find a run by its id, or by task+date when the reporter predates run ids. */
export function findRun(history: RunRecord[], key: string): RunRecord | null {
  return history.find(r => r.runId === key) ?? history.find(r => `${r.task}|${r.date}` === key) ?? null;
}

/** The stable key a UI should send back for a run. */
export function runKey(r: RunRecord): string {
  return r.runId || `${r.task}|${r.date}`;
}

function messages(r: RunRecord): string[] {
  return (r.warningItems ?? []).map(w => (w?.msg ?? '').trim()).filter(Boolean);
}
