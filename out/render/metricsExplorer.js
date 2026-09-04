"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderMetricsExplorer = renderMetricsExplorer;
const metricsExplorer_1 = require("../logic/metricsExplorer");
const sparkline_1 = require("../logic/sparkline");
const time_1 = require("../logic/time");
const html_1 = require("./html");
const SPARK_W = 60;
const SPARK_H = 16;
/** "09-01" — a column header short enough for a table that may hold a dozen runs. */
function shortDate(iso) {
    const d = (0, time_1.parseIso)(iso);
    if (!d)
        return '?';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** A cell's text: numbers get the compact metric format, strings are shown as written. */
function cell(value) {
    if (value === undefined)
        return '<span class="mx-absent" title="not reported by this run">—</span>';
    if (typeof value === 'number')
        return (0, html_1.esc)((0, sparkline_1.formatMetric)(value));
    return (0, html_1.esc)(value);
}
/** The signed "Δ vs prev" cell, with the percentage when there is one. */
function deltaCell(row) {
    if (row.delta === null || !isFinite(row.delta)) {
        const why = row.previous === undefined ? 'no earlier run reported this metric' : 'not a numeric change';
        return `<td class="mx-delta mx-flat" title="${(0, html_1.esc)(why)}">—</td>`;
    }
    const cls = row.delta > 0 ? 'mx-up' : row.delta < 0 ? 'mx-down' : 'mx-flat';
    const sign = row.delta > 0 ? '+' : row.delta < 0 ? '-' : '';
    const value = `${sign}${(0, html_1.esc)((0, sparkline_1.formatMetric)(Math.abs(row.delta)))}`;
    const pct = row.pct === null || !isFinite(row.pct)
        ? ''
        : ` <span class="mx-pct">(${row.pct > 0 ? '+' : row.pct < 0 ? '-' : ''}${(0, html_1.esc)(Math.abs(row.pct).toFixed(1))}%)</span>`;
    const title = row.previous === undefined ? '' : ` title="previous ${(0, html_1.esc)((0, html_1.metricText)(row.previous))}"`;
    return `<td class="mx-delta ${cls}"${title}>${value}${pct}</td>`;
}
/**
 * Sum across the runs in view, with the mean alongside. A per-run number that is worth
 * accumulating — a cost, a row count — reads as a period total, which the run-by-run columns
 * never answer on their own.
 */
function totalCell(row) {
    if (row.total === null)
        return '<td class="mx-total muted">—</td>';
    const title = row.mean === null ? '' : ` title="${(0, html_1.esc)(`${row.series.length} run(s) · mean ${(0, sparkline_1.formatMetric)(row.mean)}`)}"`;
    return `<td class="mx-total"${title}>${(0, html_1.esc)((0, sparkline_1.formatMetric)(row.total))}</td>`;
}
/** Metric name plus, for numeric metrics, the trend of the values in view. */
function keyCell(row) {
    const spark = row.numeric && row.series.length > 0
        ? `<svg class="mx-spark" viewBox="0 0 ${SPARK_W} ${SPARK_H}" preserveAspectRatio="none" aria-hidden="true"><path class="sparkline" d="${(0, sparkline_1.sparklinePath)(row.series, SPARK_W, SPARK_H, 2)}"/></svg>`
        : '';
    // The NAME goes in the tooltip first. The cell is capped at 200px (110px in the sidebar) with
    // an ellipsis, and the metric name appears nowhere else - so a long one was unrecoverable, and
    // the only tooltip on it described the value range instead of saying what the row was.
    const range = row.min !== null && row.max !== null
        ? ` · min ${(0, html_1.esc)((0, sparkline_1.formatMetric)(row.min))} · max ${(0, html_1.esc)((0, sparkline_1.formatMetric)(row.max))}`
        : '';
    return `<td class="mx-key"><span class="mx-key-name" title="${(0, html_1.esc)(row.key)}${range}">${(0, html_1.esc)(row.key)}</span>${spark}</td>`;
}
function runHeader(run) {
    const cls = run.success ? 'mx-run' : 'mx-run mx-run-failed';
    const title = `${(0, time_1.dateTime)(run.date)}${run.success ? '' : ' · failed'}${run.runId ? ` · ${run.runId}` : ''}`;
    return `<th class="${cls}" title="${(0, html_1.esc)(title)}"><span class="mx-run-d">${(0, html_1.esc)(shortDate(run.date))}</span><span class="mx-run-t">${(0, html_1.esc)((0, time_1.clockTime)(run.date))}</span></th>`;
}
function renderMetricsExplorer(data, settings, now, opts, narrow) {
    const model = (0, metricsExplorer_1.metricsModel)(data, settings);
    if (model.tasks.length === 0) {
        return (0, html_1.section)('metrics', 'Metrics Explorer', (0, html_1.empty)('No metrics yet. Scripts add them with Progress.metric(name, value).'), opts);
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
  <div class="mx-task-head"><span class="mx-task-name" title="${(0, html_1.esc)(t.task)}">${(0, html_1.esc)(t.task)}</span><span class="mx-task-meta muted small">${t.runs.length} ${runWord} · latest ${(0, html_1.esc)((0, time_1.relativeTime)(t.latestDate, now))}</span></div>
  <div class="table-wrap"><table class="mx-table">
    <thead><tr><th class="mx-key-h">Metric</th>${head}<th class="mx-delta-h" title="Change against the previous value">Δ vs prev</th>${settings.metricsExplorer.totals ? '<th class="mx-total-h" title="Sum of the runs in view (mean in the tooltip)">Total</th>' : ''}</tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
</div>`;
    }).join('');
    const aside = `${model.metricCount} metric${model.metricCount === 1 ? '' : 's'} · ${model.taskCount} task${model.taskCount === 1 ? '' : 's'}`;
    return (0, html_1.section)('metrics', 'Metrics Explorer', `<div class="mx-wrap">${blocks}</div>`, { ...opts, aside });
}
//# sourceMappingURL=metricsExplorer.js.map