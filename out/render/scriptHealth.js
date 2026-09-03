"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderScriptHealth = renderScriptHealth;
const health_1 = require("../logic/health");
const time_1 = require("../logic/time");
const html_1 = require("./html");
function renderScriptHealth(data, settings, now) {
    const rows = (0, health_1.healthRows)(data.history, settings.staleHours, now);
    if (rows.length === 0)
        return (0, html_1.section)('scriptHealth', 'Script Health', (0, html_1.empty)('No runs recorded yet.'));
    const tr = rows
        .map(r => {
        const fCls = r.freshness === 'fresh' ? 'status-pass' : r.freshness === 'aging' ? 'status-warn' : 'status-stale';
        const fIcon = r.freshness === 'fresh' ? 'pass' : r.freshness === 'aging' ? 'clock' : 'warning';
        return `<tr>
  <td class="col-task" title="${(0, html_1.esc)(r.task)}">${(0, html_1.esc)(r.task)}</td>
  <td class="col-date">${(0, html_1.esc)((0, time_1.relativeTime)(r.last.date, now))}</td>
  <td class="col-dur">${(0, html_1.esc)((0, time_1.formatDuration)(r.last.elapsed))}</td>
  <td class="col-status ${r.last.success ? 'status-pass' : 'status-fail'}">${(0, html_1.icon)(r.last.success ? 'check' : 'error')}</td>
  <td class="col-fresh ${fCls}" title="${r.runs} runs, ${r.failures} failed">${(0, html_1.icon)(fIcon)} ${r.freshness}</td>
</tr>`;
    })
        .join('');
    const stale = rows.filter(r => r.freshness === 'stale').length;
    const title = stale ? `Script Health (${stale} stale)` : 'Script Health';
    const body = `<div class="table-wrap"><table>
  <thead><tr><th>Task</th><th>Last run</th><th>Duration</th><th>Result</th><th>Freshness</th></tr></thead>
  <tbody>${tr}</tbody>
</table></div>
<div class="muted small">Stale after ${settings.staleHours}h without a run.</div>`;
    return (0, html_1.section)('scriptHealth', title, body);
}
//# sourceMappingURL=scriptHealth.js.map