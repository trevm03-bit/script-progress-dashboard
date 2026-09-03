"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderScriptHealth = renderScriptHealth;
const health_1 = require("../logic/health");
const sparkline_1 = require("../logic/sparkline");
const time_1 = require("../logic/time");
const html_1 = require("./html");
function renderScriptHealth(data, settings, now, opts) {
    const rows = (0, health_1.healthRows)(data.history, settings.staleHours, now, settings.health.resultDots);
    if (rows.length === 0)
        return (0, html_1.section)('scriptHealth', 'Script Health', (0, html_1.empty)('No runs recorded yet.'), opts);
    const tr = rows.map(r => {
        const fCls = r.freshness === 'fresh' ? 'status-pass' : r.freshness === 'aging' ? 'status-warn' : 'status-stale';
        const fIcon = r.freshness === 'fresh' ? 'pass' : r.freshness === 'aging' ? 'clock' : 'warning';
        const dots = settings.health.resultDots > 0
            ? `<span class="dots" title="Last ${r.recent.length} results, oldest first">${r.recent.map(ok => `<i class="dot ${ok ? 'dot-ok' : 'dot-fail'}"></i>`).join('')}</span>` : '';
        const trend = settings.runHistory.trend && r.durations.length > 1
            ? `<svg class="trend-svg" viewBox="0 0 60 16" preserveAspectRatio="none" aria-label="duration trend"><path class="sparkline" d="${(0, sparkline_1.sparklinePath)(r.durations, 60, 16, 2)}"/></svg>` : '';
        const rate = r.runs ? `${Math.round(r.failureRate * 100)}%` : '—';
        return `<tr>
  <td class="col-task" title="${(0, html_1.esc)(r.task)}">${(0, html_1.esc)(r.task)}</td>
  <td class="col-date">${(0, html_1.esc)((0, time_1.relativeTime)(r.last.date, now))}</td>
  <td class="col-dots">${dots}</td>
  <td class="col-rate ${r.failureRate >= 0.5 ? 'status-fail' : r.failureRate > 0 ? 'status-warn' : ''}" title="${r.failures} of ${r.runs} runs failed">${rate}</td>
  <td class="col-dur" title="Average of successful runs">${(0, html_1.esc)((0, time_1.formatDuration)(r.avgDuration || r.last.elapsed))}${trend}</td>
  <td class="col-fresh ${fCls}" title="${r.ageHours === Infinity ? 'unknown' : Math.round(r.ageHours) + 'h since last run'}">${(0, html_1.icon)(fIcon)} ${r.freshness}</td>
</tr>`;
    }).join('');
    const stale = rows.filter(r => r.freshness === 'stale').length;
    const body = `<div class="table-wrap"><table class="health">
  <thead><tr><th>Task</th><th>Last run</th><th>Recent</th><th>Fail %</th><th>Avg · trend</th><th>Freshness</th></tr></thead>
  <tbody>${tr}</tbody>
</table></div>
<div class="muted small">Stale after ${settings.staleHours}h without a run · ${rows.length} task${rows.length === 1 ? '' : 's'} seen</div>`;
    return (0, html_1.section)('scriptHealth', 'Script Health', body, { ...opts, aside: stale ? `<span class="status-fail">${stale} stale</span>` : '' });
}
//# sourceMappingURL=scriptHealth.js.map