// Script Health: the most recent run per task, recent results, failure rate, duration trend, staleness.
import { RunRecord } from '../types';
import { parseIso } from './time';

export type Freshness = 'fresh' | 'aging' | 'stale';

export interface HealthRow {
  task: string;
  last: RunRecord;
  runs: number;
  failures: number;
  /** 0..1 */
  failureRate: number;
  /** Newest-last durations of successful runs (for a trend sparkline). */
  durations: number[];
  avgDuration: number;
  /** Newest-last recent results, true = success. */
  recent: boolean[];
  ageHours: number;
  freshness: Freshness;
}

/** Group history by task name; newest run wins. Sorted newest-first. */
export function latestPerTask(history: RunRecord[]): { task: string; last: RunRecord; runs: number; failures: number; all: RunRecord[] }[] {
  const byTask = new Map<string, { task: string; last: RunRecord; runs: number; failures: number; all: RunRecord[] }>();
  for (const r of history) {
    if (!r || !r.task) continue;
    const cur = byTask.get(r.task);
    const t = parseIso(r.date)?.getTime() ?? 0;
    if (!cur) {
      byTask.set(r.task, { task: r.task, last: r, runs: 1, failures: r.success ? 0 : 1, all: [r] });
    } else {
      cur.runs++;
      cur.all.push(r);
      if (!r.success) cur.failures++;
      if (t > (parseIso(cur.last.date)?.getTime() ?? 0)) cur.last = r;
    }
  }
  return [...byTask.values()].sort(
    (a, b) => (parseIso(b.last.date)?.getTime() ?? 0) - (parseIso(a.last.date)?.getTime() ?? 0)
  );
}

/** fresh = under a quarter of the stale window; aging = under the window; stale = past it. */
export function freshness(lastIso: string, staleHours: number, now: Date): { ageHours: number; freshness: Freshness } {
  const d = parseIso(lastIso);
  if (!d) return { ageHours: Infinity, freshness: 'stale' };
  const ageHours = Math.max(0, (now.getTime() - d.getTime()) / 3600000);
  if (ageHours < staleHours * 0.25) return { ageHours, freshness: 'fresh' };
  if (ageHours < staleHours) return { ageHours, freshness: 'aging' };
  return { ageHours, freshness: 'stale' };
}

export function healthRows(history: RunRecord[], staleHours: number, now: Date, dots = 5): HealthRow[] {
  return latestPerTask(history).map(t => {
    const chrono = t.all.slice().sort((a, b) => (parseIso(a.date)?.getTime() ?? 0) - (parseIso(b.date)?.getTime() ?? 0));
    const durations = chrono.filter(r => r.success && typeof r.elapsed === 'number').map(r => r.elapsed).slice(-20);
    const avgDuration = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
    const recent = chrono.slice(-Math.max(0, dots)).map(r => !!r.success);
    return {
      task: t.task,
      last: t.last,
      runs: t.runs,
      failures: t.failures,
      failureRate: t.runs ? t.failures / t.runs : 0,
      durations,
      avgDuration,
      recent,
      ...freshness(t.last.date, staleHours, now),
    };
  });
}
