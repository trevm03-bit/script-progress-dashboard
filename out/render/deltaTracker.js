"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderDeltaTracker = renderDeltaTracker;
const sparkline_1 = require("../logic/sparkline");
const time_1 = require("../logic/time");
const html_1 = require("./html");
const W = 220;
const H = 44;
function renderDeltaTracker(data, settings, now) {
    const available = Object.keys(data.deltas || {});
    const names = settings.deltaMetrics.length ? settings.deltaMetrics : available;
    if (names.length === 0)
        return (0, html_1.section)('deltaTracker', 'Delta Tracker', (0, html_1.empty)('No metrics in deltas.json yet. Scripts add them with Progress.track_delta().'));
    const cards = names
        .map(name => {
        const pts = data.deltas[name] ?? [];
        const values = pts.map(p => p.value);
        const stats = (0, sparkline_1.seriesStats)(values);
        if (!stats) {
            return `<div class="delta"><div class="delta-name">${(0, html_1.esc)(name)}</div>${(0, html_1.empty)('no data yet')}</div>`;
        }
        const trendCls = stats.trend === 'up' ? 'trend-up' : stats.trend === 'down' ? 'trend-down' : 'trend-flat';
        const trendIcon = stats.trend === 'up' ? 'arrow-up' : stats.trend === 'down' ? 'arrow-down' : 'arrow-right';
        const last = pts[pts.length - 1];
        return `<div class="delta">
  <div class="delta-head"><span class="delta-name" title="${(0, html_1.esc)(name)}">${(0, html_1.esc)(name)}</span><span class="delta-current ${trendCls}">${(0, html_1.esc)((0, sparkline_1.formatMetric)(stats.current))} ${(0, html_1.icon)(trendIcon)}</span></div>
  <svg class="sparkline-svg ${trendCls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="${(0, html_1.esc)(name)} trend">
    <path class="sparkline" d="${(0, sparkline_1.sparklinePath)(values, W, H, 3)}"/>
  </svg>
  <div class="delta-stats muted small">
    <span>min ${(0, html_1.esc)((0, sparkline_1.formatMetric)(stats.min))}</span><span>max ${(0, html_1.esc)((0, sparkline_1.formatMetric)(stats.max))}</span>
    <span>Δ ${stats.change >= 0 ? '+' : ''}${(0, html_1.esc)((0, sparkline_1.formatMetric)(stats.change))}</span>
    <span>${pts.length} pts · ${(0, html_1.esc)((0, time_1.relativeTime)(last?.date, now))}</span>
  </div>
</div>`;
    })
        .join('');
    return (0, html_1.section)('deltaTracker', 'Delta Tracker', `<div class="delta-grid">${cards}</div>`);
}
//# sourceMappingURL=deltaTracker.js.map