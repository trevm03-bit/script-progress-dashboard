"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderLastCompleted = renderLastCompleted;
const time_1 = require("../logic/time");
const html_1 = require("./html");
function renderLastCompleted(data, now) {
    const sorted = data.history
        .slice()
        .sort((a, b) => ((0, time_1.parseIso)(b.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.date)?.getTime() ?? 0));
    const last = sorted[0];
    if (!last)
        return (0, html_1.section)('lastCompleted', 'Last Completed', (0, html_1.empty)('No completed runs yet.'));
    const statusCls = last.success ? 'status-pass' : 'status-fail';
    const statusIcon = last.success ? 'check' : 'error';
    const statusText = last.success ? 'OK' : 'FAILED';
    const body = `
  <div class="metrics">
    <div class="metric"><div class="metric-value ${statusCls}">${(0, html_1.icon)(statusIcon)} ${statusText}</div><div class="metric-label">Status</div></div>
    <div class="metric"><div class="metric-value">${(0, html_1.esc)((0, time_1.formatDuration)(last.elapsed))}</div><div class="metric-label">Duration</div></div>
    <div class="metric"><div class="metric-value ${last.warnings ? 'status-warn' : ''}">${last.warnings ?? 0}</div><div class="metric-label">Warnings</div></div>
  </div>
  <div class="last-name" title="${(0, html_1.esc)(last.task)}">${(0, html_1.esc)(last.task)} <span class="muted">· ${(0, html_1.esc)((0, time_1.relativeTime)(last.date, now))}</span></div>
  ${last.summary ? `<div class="last-summary">${(0, html_1.esc)(last.summary)}</div>` : ''}`;
    return (0, html_1.section)('lastCompleted', 'Last Completed', body);
}
//# sourceMappingURL=lastCompleted.js.map