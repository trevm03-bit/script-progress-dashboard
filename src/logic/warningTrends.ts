// Warning Trends maths: what the same warning, phrased with different numbers, has been doing over
// the last N days. Pure — no HTML, no vscode; "now" is always passed in so tests can pin the clock.
//
// Only RunRecord.warningItems counts. A run that reports a warning COUNT but no items contributes
// nothing: there is no message to group, and inventing one would misattribute it.
import { DashboardData, RunRecord, Settings } from '../types';
import { parseIso } from './time';

export interface WarningDay {
  /** Local calendar day, "2026-09-02". */
  date: string;
  /** Short label for the axis, "09-02". */
  label: string;
  count: number;
}

export interface WarningGroup {
  /** The normalized message every member shares. */
  pattern: string;
  /** The most recent raw message in the group — what the user actually saw. */
  example: string;
  count: number;
  /** Distinct task names, most recent first, capped at 5. */
  tasks: string[];
  lastSeen: string;
  firstSeen: string;
  /** Last third of the window against the first third. */
  trend: 'rising' | 'falling' | 'flat';
}

export interface WarningTrendsModel {
  /** Warnings inside the window. */
  total: number;
  /** Oldest first, one entry per day, always exactly `days` long. */
  days: WarningDay[];
  /** The busiest groups, biggest first, capped at settings.warningTrends.top. */
  groups: WarningGroup[];
  /** Warning counts per task inside the window, biggest first. */
  byTask: { task: string; count: number }[];
  windowDays: number;
}

/**
 * The grouping key. "12 rows had no id" and "28 rows had no id" both become "# rows had no id",
 * so a recurring warning is one row rather than one row per run.
 */
export function normalizeWarning(msg: string): string {
  return String(msg ?? '')
    .replace(/\d+(?:[.,]\d+)*/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 160);
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

interface Occurrence { msg: string; task: string; time: string; t: number }

/** Every warning item in the history, timestamped (falling back to the run's own date). */
function occurrences(history: RunRecord[]): Occurrence[] {
  const out: Occurrence[] = [];
  for (const run of history || []) {
    const items = run.warningItems;
    if (!Array.isArray(items) || items.length === 0) continue;   // a bare count has no message
    for (const item of items) {
      if (!item || typeof item.msg !== 'string' || !item.msg.trim()) continue;
      const itemTime = parseIso(item.time);
      const when = itemTime ?? parseIso(run.date);
      if (!when) continue;
      // Keep the timestamp exactly as written so the section can show it back unchanged.
      out.push({ msg: item.msg, task: run.task, time: itemTime ? item.time : run.date, t: when.getTime() });
    }
  }
  return out;
}

export function warningTrendsModel(data: DashboardData, settings: Settings, now: Date): WarningTrendsModel {
  const cfg = settings.warningTrends || { days: 14, top: 5 };
  const windowDays = Math.max(1, Math.floor(cfg.days) || 1);
  const top = Math.max(1, Math.floor(cfg.top) || 1);

  // `windowDays` calendar days ending with today, oldest first.
  const today = startOfDay(now);
  const days: WarningDay[] = [];
  const index = new Map<string, number>();
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const key = dayKey(d);
    index.set(key, days.length);
    days.push({ date: key, label: key.slice(5), count: 0 });
  }
  const windowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (windowDays - 1)).getTime();

  const inWindow = occurrences(data.history).filter(o => o.t >= windowStart && o.t <= now.getTime());
  inWindow.sort((a, b) => a.t - b.t);

  for (const o of inWindow) {
    const i = index.get(dayKey(new Date(o.t)));
    if (i !== undefined) days[i].count++;
  }

  // A third of the window at each end, at least one day, and never overlapping.
  const third = Math.max(1, Math.min(Math.floor(windowDays / 3), Math.floor(windowDays / 2)));

  const buckets = new Map<string, Occurrence[]>();
  for (const o of inWindow) {
    const key = normalizeWarning(o.msg);
    const list = buckets.get(key);
    if (list) list.push(o); else buckets.set(key, [o]);
  }

  const groups: WarningGroup[] = [];
  for (const [pattern, list] of buckets) {
    // list is already oldest-first (inWindow was sorted).
    const first = list[0];
    const last = list[list.length - 1];
    const tasks: string[] = [];
    for (let i = list.length - 1; i >= 0 && tasks.length < 5; i--) {
      if (!tasks.includes(list[i].task)) tasks.push(list[i].task);
    }
    let early = 0;
    let late = 0;
    for (const o of list) {
      const i = index.get(dayKey(new Date(o.t)));
      if (i === undefined) continue;
      if (i < third) early++;
      if (i >= days.length - third) late++;
    }
    groups.push({
      pattern,
      example: last.msg,
      count: list.length,
      tasks,
      firstSeen: first.time,
      lastSeen: last.time,
      trend: late > early ? 'rising' : late < early ? 'falling' : 'flat',
    });
  }
  const at = (iso: string) => parseIso(iso)?.getTime() ?? 0;
  groups.sort((a, b) => b.count - a.count || at(b.lastSeen) - at(a.lastSeen) || a.pattern.localeCompare(b.pattern));

  const perTask = new Map<string, number>();
  for (const o of inWindow) perTask.set(o.task, (perTask.get(o.task) || 0) + 1);
  const byTask = [...perTask.entries()]
    .map(([task, count]) => ({ task, count }))
    .sort((a, b) => b.count - a.count || a.task.localeCompare(b.task));

  return { total: inWindow.length, days, groups: groups.slice(0, top), byTask, windowDays };
}
