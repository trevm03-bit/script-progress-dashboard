"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderLastCompleted = renderLastCompleted;
const time_1 = require("../logic/time");
const html_1 = require("./html");
const anomaly_1 = require("../logic/anomaly");
function renderLastCompleted(data, settings, now, opts) {
    // 🔴 Not-in-the-future, exactly as summaryFacts.lastRun does. Fixing that one and not this
    // one put the two surfaces on DIFFERENT runs: for a single clock-skewed row the strip showed
    // a green "last run · 1h ago" tile while the card directly beneath it read "FAILED · just
    // now" about something else. Half a fix turned one wrong number into a contradiction.
    const sorted = data.history
        .filter(r => ((0, time_1.parseIso)(r.date)?.getTime() ?? 0) <= now.getTime())
        .sort((a, b) => ((0, time_1.parseIso)(b.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.date)?.getTime() ?? 0));
    const last = sorted[0];
    if (!last)
        return (0, html_1.section)('lastCompleted', 'Last Completed', (0, html_1.empty)('No completed runs yet.'), opts);
    const statusCls = last.success ? 'status-pass' : 'status-fail';
    const statusIcon = last.success ? 'check' : 'error';
    const statusText = last.success ? 'OK' : 'FAILED';
    const metricCards = last.metrics && Object.keys(last.metrics).length
        ? Object.entries(last.metrics).slice(0, 8).map(([k, v]) => `<div class="metric metric-user"><div class="metric-value">${(0, html_1.esc)((0, html_1.metricText)(v))}</div><div class="metric-label" title="${(0, html_1.esc)(k)}">${(0, html_1.esc)(k)}</div></div>`).join('')
        : '';
    const artifacts = settings.activeTask.showArtifacts && last.artifacts && last.artifacts.length
        ? `<div class="artifacts">${last.artifacts.map(a => `<button class="link-btn" data-open="${(0, html_1.esc)(a)}" title="${(0, html_1.esc)(a)}">${(0, html_1.icon)('file')}${(0, html_1.esc)(a.split(/[\\/]/).pop() || a)}</button>`).join('')}</div>` : '';
    const verdict = settings.runHistory.anomalies ? (0, anomaly_1.durationVerdict)(last, data.history, settings.runHistory.anomalyFactor) : undefined;
    const sla = (0, anomaly_1.overSla)(last.task, Number(last.elapsed) || 0, settings.processes);
    const note = verdict?.slow
        ? `<div class="state-note status-warn">${(0, html_1.icon)('dashboard')} ${(0, html_1.esc)(`${verdict.factor.toFixed(1)}× slower than usual — this task normally takes ${(0, time_1.formatDuration)(verdict.baseline)}.`)}</div>`
        : sla ? `<div class="state-note status-fail">${(0, html_1.icon)('alert')} Ran longer than the limit set for this process.</div>` : '';
    const body = `
  <div class="metrics">
    <div class="metric"><div class="metric-value ${statusCls}">${(0, html_1.icon)(statusIcon)} ${statusText}</div><div class="metric-label">Status</div></div>
    <div class="metric"><div class="metric-value">${(0, html_1.esc)((0, time_1.formatDuration)(last.elapsed))}</div><div class="metric-label">Duration</div></div>
    <div class="metric"><div class="metric-value ${last.warnings ? 'status-warn' : ''}">${Number(last.warnings) || 0}</div><div class="metric-label">Warnings</div></div>
    ${metricCards}
  </div>
  <div class="last-name" title="${(0, html_1.esc)(last.task)}">${(0, html_1.esc)(last.task)} <span class="muted">· ${(0, html_1.esc)((0, time_1.relativeTime)(last.date, now))}</span></div>
  ${last.summary ? `<div class="last-summary">${(0, html_1.esc)(last.summary)}</div>` : ''}
  ${artifacts}${note}`;
    return (0, html_1.section)('lastCompleted', 'Last Completed', body, opts);
}
//# sourceMappingURL=lastCompleted.js.map