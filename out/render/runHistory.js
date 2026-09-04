"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderRunHistory = renderRunHistory;
const time_1 = require("../logic/time");
const html_1 = require("./html");
const anomaly_1 = require("../logic/anomaly");
const compare_1 = require("../logic/compare");
function renderRunHistory(data, settings, opts) {
    const all = data.history
        .slice()
        .sort((a, b) => ((0, time_1.parseIso)(b.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.date)?.getTime() ?? 0));
    const rows = all.slice(0, Math.max(1, settings.runHistory.maxRows));
    if (rows.length === 0)
        return (0, html_1.section)('runHistory', 'Run History', (0, html_1.empty)('No runs recorded yet.'), opts);
    const failed = all.filter(r => !r.success).length;
    const filters = settings.runHistory.filters ? `<div class="filters">
    <input type="search" class="filter-text" placeholder="Filter runs…" aria-label="Filter runs" spellcheck="false">
    <div class="chips-row" role="group" aria-label="Status filter">
      <button class="fchip active" data-filter="all">All <span class="n">${all.length}</span></button>
      <button class="fchip" data-filter="ok">OK <span class="n">${all.length - failed}</span></button>
      <button class="fchip" data-filter="fail">Failed <span class="n">${failed}</span></button>
      <button class="fchip" data-filter="warn">With warnings <span class="n">${all.filter(r => r.warnings).length}</span></button>
      ${settings.runHistory.anomalies ? `<button class="fchip" data-filter="slow">Slow <span class="n">${all.filter(r => (0, anomaly_1.durationVerdict)(r, all, settings.runHistory.anomalyFactor).slow || (0, anomaly_1.overSla)(r.task, Number(r.elapsed) || 0, settings.processes)).length}</span></button>` : ''}
    </div>
  </div>` : '';
    const tr = rows.map(r => historyRow(r, settings, all)).join('');
    const body = `${filters}<div class="table-wrap"><table class="sortable history" data-table="history">
  <thead><tr>
    <th data-col="0" title="Sort">St</th>
    <th data-col="1" title="Sort">Task</th>
    <th data-col="2" title="Sort" class="sorted-desc">Date</th>
    <th data-col="3" title="Sort">Duration</th>
    <th data-col="4" title="Sort">Warn</th>
    <th>Summary</th>
  </tr></thead>
  <tbody>${tr}</tbody>
</table></div>
<div class="muted small table-foot"><span class="shown">Showing ${rows.length} of ${all.length} runs</span>${all.length > rows.length ? ` · raise <code>runHistory.maxRows</code> to see more` : ''} · <button class="link-btn" data-msg="exportCsv">${(0, html_1.icon)('export')}Export CSV</button></div>`;
    return (0, html_1.section)('runHistory', 'Run History', body, { ...opts, aside: failed ? `<span class="status-fail">${failed} failed</span>` : '' });
}
function historyRow(r, settings, all) {
    const t = (0, time_1.parseIso)(r.date)?.getTime() ?? 0;
    const verdict = settings.runHistory.anomalies ? (0, anomaly_1.durationVerdict)(r, all, settings.runHistory.anomalyFactor) : undefined;
    const sla = (0, anomaly_1.overSla)(r.task, Number(r.elapsed) || 0, settings.processes);
    const limit = (0, anomaly_1.slaFor)(r.task, settings.processes);
    const flags = [
        verdict?.slow ? `<span class="flag flag-slow" title="${(0, html_1.esc)(`${verdict.factor.toFixed(1)}x the usual ${(0, time_1.formatDuration)(verdict.baseline)} (median of ${verdict.sample} runs)`)}">${(0, html_1.icon)('dashboard')}${verdict.factor.toFixed(1)}×</span>` : '',
        sla ? `<span class="flag flag-sla" title="Over the maxMinutes limit set for this process">${(0, html_1.icon)('alert')}SLA</span>` : '',
    ].join('');
    const hay = `${r.task} ${r.summary ?? ''} ${Object.entries(r.metrics || {}).map(([k, v]) => `${k} ${v}`).join(' ')}`.toLowerCase();
    const kinds = [r.success ? 'ok' : 'fail', r.warnings ? 'warn' : '', verdict?.slow || sla ? 'slow' : ''].filter(Boolean).join(' ');
    const expandable = settings.runHistory.detail;
    const main = `<tr class="${r.success ? '' : 'row-failed'}${expandable ? ' expandable' : ''}" data-hay="${(0, html_1.esc)(hay)}" data-kinds="${kinds}">
  <td class="col-status ${r.success ? 'status-pass' : 'status-fail'}" data-sort="${r.success ? 1 : 0}">${(0, html_1.icon)(r.success ? 'check' : 'error')}</td>
  <td class="col-task" data-sort="${(0, html_1.esc)(r.task.toLowerCase())}" title="${(0, html_1.esc)(r.task)}">${expandable ? (0, html_1.icon)('chevron-right', 'row-chev') : ''}${(0, html_1.esc)(r.task)}</td>
  <td class="col-date" data-sort="${t}">${(0, html_1.esc)((0, time_1.dateTime)(r.date))}</td>
  <td class="col-dur" data-sort="${Number(r.elapsed) || 0}">${(0, html_1.esc)((0, time_1.formatDuration)(Number(r.elapsed) || 0))}${flags}</td>
  <td class="col-warn ${r.warnings ? 'status-warn' : ''}" data-sort="${Number(r.warnings) || 0}">${Number(r.warnings) || 0}</td>
  <td class="col-summary" title="${(0, html_1.esc)(r.summary)}">${r.category ? `<span class="cat-chip" title="Failure category reported by the script">${(0, html_1.esc)(r.category)}</span>` : ''}${(0, html_1.esc)(r.summary)}${firstWarning(r)}</td>
</tr>`;
    if (!expandable)
        return main;
    const parts = [];
    if (r.metrics && Object.keys(r.metrics).length) {
        const prev = (0, anomaly_1.previousRun)(r, all);
        const changes = (0, anomaly_1.metricChanges)(r, prev);
        parts.push(`<div class="detail-block"><div class="detail-h">Metrics${prev ? ' <span class="muted">vs previous run</span>' : ''}</div><div class="chips">${changes.map(c => {
            const d = c.delta === null ? '' : `<span class="chip-d ${c.delta > 0 ? 'status-pass' : c.delta < 0 ? 'status-fail' : 'muted'}" title="${(0, html_1.esc)(`previous ${(0, html_1.metricText)(c.previous ?? '')}`)}">${c.delta > 0 ? '▲' : c.delta < 0 ? '▼' : '='} ${(0, html_1.esc)((0, html_1.metricText)(Math.abs(c.delta)))}${c.pct !== null ? ` (${c.pct > 0 ? '+' : ''}${c.pct.toFixed(1)}%)` : ''}</span>`;
            return `<span class="chip"><span class="chip-k">${(0, html_1.esc)(c.key)}</span><span class="chip-v">${(0, html_1.esc)((0, html_1.metricText)(c.value))}</span>${d}</span>`;
        }).join('')}</div></div>`);
    }
    if (verdict && verdict.sample >= 3)
        parts.push(`<div class="detail-block"><div class="detail-h">Duration</div><div class="small ${verdict.slow ? 'status-warn' : 'muted'}">${verdict.slow ? (0, html_1.icon)('dashboard') + ' ' : ''}${(0, html_1.esc)(`${verdict.factor.toFixed(2)}× the usual ${(0, time_1.formatDuration)(verdict.baseline)} (median of the previous ${verdict.sample} successful runs)`)}${sla && limit ? ` · <span class="status-fail">over the ${(0, html_1.esc)((0, time_1.formatDuration)(limit * 60))} limit</span>` : ''}</div></div>`);
    else if (sla && limit)
        parts.push(`<div class="detail-block"><div class="detail-h">Duration</div><div class="small status-fail">${(0, html_1.icon)('alert')} Over the ${(0, html_1.esc)((0, time_1.formatDuration)(limit * 60))} limit set for this process.</div></div>`);
    if (r.warningItems && r.warningItems.length)
        parts.push(`<div class="detail-block"><div class="detail-h">Warnings</div>${r.warningItems.map(w => `<div class="warning-card"><span class="warning-time">${(0, html_1.esc)((0, time_1.clockTime)(w.time))}</span> ${(0, html_1.esc)(w.msg)}</div>`).join('')}</div>`);
    if (r.accessed && r.accessed.length)
        parts.push(`<div class="detail-block"><div class="detail-h">Touched</div><div class="chips">${r.accessed.map(id => { const [kind, ...rest] = id.split(':'); return `<span class="chip chip-${(0, html_1.esc)(kind)}"><span class="chip-k">${(0, html_1.esc)(kind)}</span><span class="chip-v">${(0, html_1.esc)(rest.join(':'))}</span></span>`; }).join('')}</div></div>`);
    if (r.artifacts && r.artifacts.length)
        parts.push(`<div class="detail-block"><div class="detail-h">Artifacts</div><div class="artifacts">${r.artifacts.map(a => `<button class="link-btn" data-open="${(0, html_1.esc)(a)}" title="${(0, html_1.esc)(a)}">${(0, html_1.icon)('file')}${(0, html_1.esc)(a.split(/[\\/]/).pop() || a)}</button>`).join('')}</div></div>`);
    parts.push(`<div class="detail-actions"><button class="link-btn" data-msg="compare" data-key="${(0, html_1.esc)((0, compare_1.runKey)(r))}" title="Compare this run with another">${(0, html_1.icon)('git-compare')}Compare with…</button></div>`);
    const ids = [r.runId ? `run ${r.runId}` : '', r.startedAt ? `started ${(0, time_1.dateTime)(r.startedAt)}` : ''].filter(Boolean).join(' · ');
    if (ids)
        parts.push(`<div class="detail-block muted small mono">${(0, html_1.esc)(ids)}</div>`);
    if (!parts.length)
        parts.push(`<div class="detail-block muted small">No extra detail recorded for this run (older reporter).</div>`);
    return main + `<tr class="detail" hidden><td colspan="6"><div class="detail-wrap">${parts.join('')}</div></td></tr>`;
}
/**
 * The first warning, inline under the summary. For a diagnostic script the warning text IS the
 * finding — "Section 5: 2 issues" is the whole point of the run — and putting it behind an
 * expand meant the row showed a count where it could have shown the answer.
 */
function firstWarning(r) {
    const first = r.warningItems && r.warningItems.length ? r.warningItems[0].msg : '';
    if (!first)
        return '';
    const more = (r.warningItems?.length ?? 0) - 1;
    const text = first.length > 90 ? first.slice(0, 89) + '…' : first;
    return `<div class="row-warn" title="${(0, html_1.esc)(first)}">${(0, html_1.icon)('warning')}${(0, html_1.esc)(text)}${more > 0 ? `<span class="muted"> +${more} more</span>` : ''}</div>`;
}
//# sourceMappingURL=runHistory.js.map