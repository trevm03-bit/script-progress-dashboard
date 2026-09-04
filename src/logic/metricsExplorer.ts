// Metrics Explorer maths: for each task, the last N runs that reported anything through
// Progress.metric(), the metric keys those runs used, and one row of values per key aligned to
// those runs. Pure — no HTML, no vscode, every date read through parseIso so a half-written file
// can never throw.
import { DashboardData, RunRecord, Settings } from '../types';
import { metricChanges } from './anomaly';
import { parseIso } from './time';

/** What Progress.metric() is allowed to record. */
export type MetricValue = number | string;

/** The identity of one run used as a column. */
export interface MetricsRunRef {
  date: string;
  success: boolean;
  runId?: string;
}

/** One metric across the runs in view. */
export interface MetricsRow {
  key: string;
  /** Aligned 1:1 with MetricsTask.runs; undefined where that run did not report the metric. */
  values: (MetricValue | undefined)[];
  /** true only when every value present is a finite number (a mixed row is treated as text). */
  numeric: boolean;
  /** The numeric values, in run order — what the sparkline is drawn from. Empty for text rows. */
  series: number[];
  /** Most recent value present (not necessarily from the newest run). */
  latest: MetricValue | undefined;
  /** The value before it — the newest earlier run that reported this key, skipping gaps. */
  previous: MetricValue | undefined;
  /** latest - previous, when both are numbers. */
  delta: number | null;
  /** Percentage change; null when previous is 0 (or either side is not a number). */
  pct: number | null;
  min: number | null;
  max: number | null;
  /** Sum of the numeric values in view. Null for a text row. A per-run cost or row count is
   *  usually more interesting as a period total than as a list of individual numbers. */
  total: number | null;
  /** Mean of the numeric values in view. Null for a text row. */
  mean: number | null;
}

export interface MetricsTask {
  task: string;
  /** Oldest first, so a row reads left to right as a trend. */
  runs: MetricsRunRef[];
  /** Sorted, filtered metric keys present in those runs. */
  keys: string[];
  rows: MetricsRow[];
  /** Date of the newest run in view. */
  latestDate: string;
}

export interface MetricsModel {
  /** Tasks with at least one metric, most recently active first. */
  tasks: MetricsTask[];
  /** Distinct metric keys across every task. */
  metricCount: number;
  taskCount: number;
}

/** Keep sums readable: floating point makes 0.1 + 0.2 into 0.30000000000000004. */
function round(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** The metrics of one run, minus anything the filter excludes; null when nothing is left. */
function pickMetrics(
  metrics: Record<string, number | string> | undefined,
  allow: Set<string> | null,
): Record<string, MetricValue> | null {
  if (!metrics || typeof metrics !== 'object') return null;
  const out: Record<string, MetricValue> = Object.create(null);
  let n = 0;
  for (const [key, value] of Object.entries(metrics)) {
    if (allow && !allow.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value !== 'number' && typeof value !== 'string') continue;
    out[key] = value;
    n++;
  }
  return n ? out : null;
}

export function metricsModel(data: DashboardData, settings: Settings): MetricsModel {
  const cfg = settings.metricsExplorer || { maxRuns: 5, metrics: [] };
  const maxRuns = Math.max(1, Math.floor(cfg.maxRuns) || 1);
  const wanted = (cfg.metrics || []).filter(m => typeof m === 'string' && m.length > 0);
  const allow = wanted.length ? new Set(wanted) : null;

  // Group the history by task, keeping only runs that still have a metric after filtering.
  const byTask = new Map<string, { run: RunRecord; metrics: Record<string, MetricValue>; t: number }[]>();
  for (const run of data.history || []) {
    const metrics = pickMetrics(run.metrics, allow);
    if (!metrics) continue;
    const list = byTask.get(run.task);
    const entry = { run, metrics, t: parseIso(run.date)?.getTime() ?? 0 };
    if (list) list.push(entry); else byTask.set(run.task, [entry]);
  }

  const allKeys = new Set<string>();
  const tasks: MetricsTask[] = [];

  for (const [task, entries] of byTask) {
    entries.sort((a, b) => a.t - b.t);            // oldest first …
    const used = entries.slice(-maxRuns);          // … so slice(-n) keeps the newest, newest LAST

    const keys = [...new Set(used.flatMap(e => Object.keys(e.metrics)))].sort();
    keys.forEach(k => allKeys.add(k));

    const runs: MetricsRunRef[] = used.map(e => ({ date: e.run.date, success: !!e.run.success, runId: e.run.runId }));

    // Fold each key down to its latest and previous value, then let metricChanges do the maths so
    // the explorer and the Run History detail row agree (including previous = 0 -> pct null).
    const latestMetrics: Record<string, MetricValue> = {};
    const previousMetrics: Record<string, MetricValue> = {};
    const valuesByKey = new Map<string, (MetricValue | undefined)[]>();

    for (const key of keys) {
      const values = used.map(e => (key in e.metrics ? e.metrics[key] : undefined));
      valuesByKey.set(key, values);
      const present: MetricValue[] = [];
      for (const v of values) if (v !== undefined) present.push(v);
      if (present.length >= 1) latestMetrics[key] = present[present.length - 1];
      if (present.length >= 2) previousMetrics[key] = present[present.length - 2];
    }

    const newest = used[used.length - 1].run;
    const changes = new Map(
      metricChanges(
        { ...newest, metrics: latestMetrics },
        { ...newest, metrics: previousMetrics },
      ).map(c => [c.key, c]),
    );

    const rows: MetricsRow[] = keys.map(key => {
      const values = valuesByKey.get(key)!;
      const present = values.filter((v): v is MetricValue => v !== undefined);
      const numeric = present.length > 0 && present.every(v => typeof v === 'number' && isFinite(v));
      const series = numeric ? (present as number[]) : [];
      const change = changes.get(key);
      return {
        key,
        values,
        numeric,
        series,
        latest: latestMetrics[key],
        previous: previousMetrics[key],
        delta: change?.delta ?? null,
        pct: change?.pct ?? null,
        min: series.length ? Math.min(...series) : null,
        max: series.length ? Math.max(...series) : null,
        total: series.length ? round(series.reduce((a, b) => a + b, 0)) : null,
        mean: series.length ? round(series.reduce((a, b) => a + b, 0) / series.length) : null,
      };
    });

    tasks.push({ task, runs, keys, rows, latestDate: newest.date });
  }

  // Most recently active task first.
  tasks.sort((a, b) => (parseIso(b.latestDate)?.getTime() ?? 0) - (parseIso(a.latestDate)?.getTime() ?? 0));

  return { tasks, metricCount: allKeys.size, taskCount: tasks.length };
}
