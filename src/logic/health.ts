// Script Health: the most recent run per task, and how stale that is.
import { RunRecord } from '../types';
import { parseIso } from './time';

export type Freshness = 'fresh' | 'aging' | 'stale';

export interface HealthRow {
  task: string;
  last: RunRecord;
  runs: number;
  failures: number;
  ageHours: number;
  freshness: Freshness;
}

/** Group history by task name; newest run wins. Sorted newest-first. */
export function latestPerTask(history: RunRecord[]): { task: string; last: RunRecord; runs: number; failures: number }[] {
  const byTask = new Map<string, { task: string; last: RunRecord; runs: number; failures: number }>();
  for (const r of history) {
    if (!r || !r.task) continue;
    const cur = byTask.get(r.task);
    const t = parseIso(r.date)?.getTime() ?? 0;
    if (!cur) {
      byTask.set(r.task, { task: r.task, last: r, runs: 1, failures: r.success ? 0 : 1 });
    } else {
      cur.runs++;
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

export function healthRows(history: RunRecord[], staleHours: number, now: Date): HealthRow[] {
  return latestPerTask(history).map(t => ({ ...t, ...freshness(t.last.date, staleHours, now) }));
}
