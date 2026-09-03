"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderRunHistory = renderRunHistory;
const time_1 = require("../logic/time");
const html_1 = require("./html");
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
    </div>
  </div>` : '';
    const tr = rows.map(r => historyRow(r, settings)).join('');
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
function historyRow(r, settings) {
    const t = (0, time_1.parseIso)(r.date)?.getTime() ?? 0;
    const hay = `${r.task} ${r.summary ?? ''} ${Object.entries(r.metrics || {}).map(([k, v]) => `${k} ${v}`).join(' ')}`.toLowerCase();
    const kinds = [r.success ? 'ok' : 'fail', r.warnings ? 'warn' : ''].filter(Boolean).join(' ');
    const expandable = settings.runHistory.detail;
    const main = `<tr class="${r.success ? '' : 'row-failed'}${expandable ? ' expandable' : ''}" data-hay="${(0, html_1.esc)(hay)}" data-kinds="${kinds}">
  <td class="col-status ${r.success ? 'status-pass' : 'status-fail'}" data-sort="${r.success ? 1 : 0}">${(0, html_1.icon)(r.success ? 'check' : 'error')}</td>
  <td class="col-task" data-sort="${(0, html_1.esc)(r.task.toLowerCase())}" title="${(0, html_1.esc)(r.task)}">${expandable ? (0, html_1.icon)('chevron-right', 'row-chev') : ''}${(0, html_1.esc)(r.task)}</td>
  <td class="col-date" data-sort="${t}">${(0, html_1.esc)((0, time_1.dateTime)(r.date))}</td>
  <td class="col-dur" data-sort="${r.elapsed}">${(0, html_1.esc)((0, time_1.formatDuration)(r.elapsed))}</td>
  <td class="col-warn ${r.warnings ? 'status-warn' : ''}" data-sort="${r.warnings ?? 0}">${r.warnings ?? 0}</td>
  <td class="col-summary" title="${(0, html_1.esc)(r.summary)}">${(0, html_1.esc)(r.summary)}</td>
</tr>`;
    if (!expandable)
        return main;
    const parts = [];
    if (r.metrics && Object.keys(r.metrics).length)
        parts.push(`<div class="detail-block"><div class="detail-h">Metrics</div><div class="chips">${Object.entries(r.metrics).map(([k, v]) => `<span class="chip"><span class="chip-k">${(0, html_1.esc)(k)}</span><span class="chip-v">${(0, html_1.esc)((0, html_1.metricText)(v))}</span></span>`).join('')}</div></div>`);
    if (r.warningItems && r.warningItems.length)
        parts.push(`<div class="detail-block"><div class="detail-h">Warnings</div>${r.warningItems.map(w => `<div class="warning-card"><span class="warning-time">${(0, html_1.esc)((0, time_1.clockTime)(w.time))}</span> ${(0, html_1.esc)(w.msg)}</div>`).join('')}</div>`);
    if (r.accessed && r.accessed.length)
        parts.push(`<div class="detail-block"><div class="detail-h">Touched</div><div class="chips">${r.accessed.map(id => { const [kind, ...rest] = id.split(':'); return `<span class="chip chip-${(0, html_1.esc)(kind)}"><span class="chip-k">${(0, html_1.esc)(kind)}</span><span class="chip-v">${(0, html_1.esc)(rest.join(':'))}</span></span>`; }).join('')}</div></div>`);
    if (r.artifacts && r.artifacts.length)
        parts.push(`<div class="detail-block"><div class="detail-h">Artifacts</div><div class="artifacts">${r.artifacts.map(a => `<button class="link-btn" data-open="${(0, html_1.esc)(a)}" title="${(0, html_1.esc)(a)}">${(0, html_1.icon)('file')}${(0, html_1.esc)(a.split(/[\\/]/).pop() || a)}</button>`).join('')}</div></div>`);
    const ids = [r.runId ? `run ${r.runId}` : '', r.startedAt ? `started ${(0, time_1.dateTime)(r.startedAt)}` : ''].filter(Boolean).join(' · ');
    if (ids)
        parts.push(`<div class="detail-block muted small mono">${(0, html_1.esc)(ids)}</div>`);
    if (!parts.length)
        parts.push(`<div class="detail-block muted small">No extra detail recorded for this run (older reporter).</div>`);
    return main + `<tr class="detail" hidden><td colspan="6"><div class="detail-wrap">${parts.join('')}</div></td></tr>`;
}
//# sourceMappingURL=runHistory.js.map