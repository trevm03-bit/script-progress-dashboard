// Metrics Explorer: one table per task — metrics down the side, runs across the top (newest last,
// so a row reads left to right as a trend), and the change against the previous value on the end.
// Numeric metrics get a sparkline under their name; text metrics show the text.
import { DashboardData, Settings } from '../types';
import { MetricsRow, MetricsRunRef, metricsModel } from '../logic/metricsExplorer';
import { formatMetric, sparklinePath } from '../logic/sparkline';
import { dateTime, clockTime, parseIso, relativeTime } from '../logic/time';
import { esc, empty, metricText, section, SectionOpts } from './html';

const SPARK_W = 60;
const SPARK_H = 16;

/** "09-01" — a column header short enough for a table that may hold a dozen runs. */
function shortDate(iso: string): string {
  const d = parseIso(iso);
  if (!d) return '?';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** A cell's text: numbers get the compact metric format, strings are shown as written. */
function cell(value: number | string | undefined): string {
  if (value === undefined) return '<span class="mx-absent" title="not reported by this run">—</span>';
  if (typeof value === 'number') return esc(formatMetric(value));
  return esc(value);
}

/** The signed "Δ vs prev" cell, with the percentage when there is one. */
function deltaCell(row: MetricsRow): string {
  if (row.delta === null || !isFinite(row.delta)) {
    const why = row.previous === undefined ? 'no earlier run reported this metric' : 'not a numeric change';
    return `<td class="mx-delta mx-flat" title="${esc(why)}">—</td>`;
  }
  const cls = row.delta > 0 ? 'mx-up' : row.delta < 0 ? 'mx-down' : 'mx-flat';
  const sign = row.delta > 0 ? '+' : row.delta < 0 ? '-' : '';
  const value = `${sign}${esc(formatMetric(Math.abs(row.delta)))}`;
  const pct = row.pct === null || !isFinite(row.pct)
    ? ''
    : ` <span class="mx-pct">(${row.pct > 0 ? '+' : row.pct < 0 ? '-' : ''}${esc(Math.abs(row.pct).toFixed(1))}%)</span>`;
  const title = row.previous === undefined ? '' : ` title="previous ${esc(metricText(row.previous))}"`;
  return `<td class="mx-delta ${cls}"${title}>${value}${pct}</td>`;
}

/**
 * Sum across the runs in view, with the mean alongside. A per-run number that is worth
 * accumulating — a cost, a row count — reads as a period total, which the run-by-run columns
 * never answer on their own.
 */
function totalCell(row: MetricsRow): string {
  if (row.total === null) return '<td class="mx-total muted">—</td>';
  const title = row.mean === null ? '' : ` title="${esc(`${row.series.length} run(s) · mean ${formatMetric(row.mean)}`)}"`;
  return `<td class="mx-total"${title}>${esc(formatMetric(row.total))}</td>`;
}

/** Metric name plus, for numeric metrics, the trend of the values in view. */
function keyCell(row: MetricsRow): string {
  const spark = row.numeric && row.series.length > 0
    ? `<svg class="mx-spark" viewBox="0 0 ${SPARK_W} ${SPARK_H}" preserveAspectRatio="none" aria-hidden="true"><path class="sparkline" d="${sparklinePath(row.series, SPARK_W, SPARK_H, 2)}"/></svg>`
    : '';
  const range = row.min !== null && row.max !== null
    ? ` title="min ${esc(formatMetric(row.min))} · max ${esc(formatMetric(row.max))}"`
    : '';
  return `<td class="mx-key"><span class="mx-key-name"${range}>${esc(row.key)}</span>${spark}</td>`;
}

function runHeader(run: MetricsRunRef): string {
  const cls = run.success ? 'mx-run' : 'mx-run mx-run-failed';
  const title = `${dateTime(run.date)}${run.success ? '' : ' · failed'}${run.runId ? ` · ${run.runId}` : ''}`;
  return `<th class="${cls}" title="${esc(title)}"><span class="mx-run-d">${esc(shortDate(run.date))}</span><span class="mx-run-t">${esc(clockTime(run.date))}</span></th>`;
}

export function renderMetricsExplorer(
  data: DashboardData,
  settings: Settings,
  now: Date,
  opts: SectionOpts,
  narrow: boolean,
): string {
  const model = metricsModel(data, settings);
  if (model.tasks.length === 0) {
    return section('metrics', 'Metrics Explorer', empty('No metrics yet. Scripts add them with Progress.metric(name, value).'), opts);
  }

  const blocks = model.tasks.map(t => {
    const head = narrow
      ? '<th class="mx-run">Latest</th>'
      : t.runs.map(runHeader).join('');
    const rows = t.rows.map(row => {
      const cells = narrow
        ? `<td class="mx-val mx-val-latest">${cell(row.latest)}</td>`
        : row.values.map((v, i) => `<td class="mx-val${i === row.values.length - 1 ? ' mx-val-latest' : ''}">${cell(v)}</td>`).join('');
      return `<tr>${keyCell(row)}${cells}${deltaCell(row)}${settings.metricsExplorer.totals ? totalCell(row) : ''}</tr>`;
    }).join('');
    const runWord = t.runs.length === 1 ? 'run' : 'runs';
    return `<div class="mx-task">
  <div class="mx-task-head"><span class="mx-task-name" title="${esc(t.task)}">${esc(t.task)}</span><span class="mx-task-meta muted small">${t.runs.length} ${runWord} · latest ${esc(relativeTime(t.latestDate, now))}</span></div>
  <div class="table-wrap"><table class="mx-table">
    <thead><tr><th class="mx-key-h">Metric</th>${head}<th class="mx-delta-h" title="Change against the previous value">Δ vs prev</th>${settings.metricsExplorer.totals ? '<th class="mx-total-h" title="Sum of the runs in view (mean in the tooltip)">Total</th>' : ''}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
</div>`;
  }).join('');

  const aside = `${model.metricCount} metric${model.metricCount === 1 ? '' : 's'} · ${model.taskCount} task${model.taskCount === 1 ? '' : 's'}`;
  return section('metrics', 'Metrics Explorer', `<div class="mx-wrap">${blocks}</div>`, { ...opts, aside });
}
