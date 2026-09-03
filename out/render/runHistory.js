"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderRunHistory = renderRunHistory;
const time_1 = require("../logic/time");
const html_1 = require("./html");
function renderRunHistory(data, settings) {
    const rows = data.history
        .slice()
        .sort((a, b) => ((0, time_1.parseIso)(b.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.date)?.getTime() ?? 0))
        .slice(0, Math.max(1, settings.runHistoryMaxRows));
    if (rows.length === 0)
        return (0, html_1.section)('runHistory', 'Run History', (0, html_1.empty)('No runs recorded yet.'));
    const tr = rows
        .map(r => {
        const t = (0, time_1.parseIso)(r.date)?.getTime() ?? 0;
        return `<tr class="${r.success ? '' : 'row-failed'}">
  <td class="col-status ${r.success ? 'status-pass' : 'status-fail'}" data-sort="${r.success ? 1 : 0}">${(0, html_1.icon)(r.success ? 'check' : 'error')}</td>
  <td class="col-task" data-sort="${(0, html_1.esc)(r.task.toLowerCase())}" title="${(0, html_1.esc)(r.task)}">${(0, html_1.esc)(r.task)}</td>
  <td class="col-date" data-sort="${t}">${(0, html_1.esc)((0, time_1.dateTime)(r.date))}</td>
  <td class="col-dur" data-sort="${r.elapsed}">${(0, html_1.esc)((0, time_1.formatDuration)(r.elapsed))}</td>
  <td class="col-warn ${r.warnings ? 'status-warn' : ''}" data-sort="${r.warnings ?? 0}">${r.warnings ?? 0}</td>
  <td class="col-summary" title="${(0, html_1.esc)(r.summary)}">${(0, html_1.esc)(r.summary)}</td>
</tr>`;
    })
        .join('');
    const body = `<div class="table-wrap"><table class="sortable" data-table="history">
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
<div class="muted small">Showing ${rows.length} of ${data.history.length} runs</div>`;
    return (0, html_1.section)('runHistory', 'Run History', body);
}
//# sourceMappingURL=runHistory.js.map