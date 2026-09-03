"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderDeltaTracker = renderDeltaTracker;
const sparkline_1 = require("../logic/sparkline");
const time_1 = require("../logic/time");
const html_1 = require("./html");
const W = 220;
const H = 48;
function renderDeltaTracker(data, settings, now, opts) {
    const available = Object.keys(data.deltas || {});
    const names = settings.deltaMetrics.length ? settings.deltaMetrics : available;
    if (names.length === 0)
        return (0, html_1.section)('deltaTracker', 'Delta Tracker', (0, html_1.empty)('No metrics in deltas.json yet. Scripts add them with Progress.track_delta().'), opts);
    let outCount = 0;
    const cards = names.map(name => {
        const fmt = settings.deltas.formats[name];
        const thr = settings.deltas.thresholds[name];
        const label = fmt?.label || name;
        const pts = (data.deltas[name] ?? []).slice(-settings.deltas.points);
        const values = pts.map(p => p.value);
        const stats = (0, sparkline_1.seriesStats)(values);
        if (!stats)
            return `<div class="delta"><div class="delta-name">${(0, html_1.esc)(label)}</div>${(0, html_1.empty)('no data yet')}</div>`;
        const bad = (0, sparkline_1.outOfRange)(stats.current, thr);
        if (bad)
            outCount++;
        const trendCls = bad ? 'trend-bad' : stats.trend === 'up' ? 'trend-up' : stats.trend === 'down' ? 'trend-down' : 'trend-flat';
        const trendIcon = stats.trend === 'up' ? 'arrow-up' : stats.trend === 'down' ? 'arrow-down' : 'arrow-right';
        const last = pts[pts.length - 1];
        // Threshold guides share the chart's scale (including the threshold values so they are always visible).
        const guideVals = [thr?.min, thr?.max].filter((v) => typeof v === 'number');
        const scaleVals = values.concat(guideVals);
        const guides = guideVals.map(v => { const y = (0, sparkline_1.sparklineY)(scaleVals, v, H, 3); return y === null ? '' : `<line class="guide" x1="0" x2="${W}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`; }).join('');
        const path = (0, sparkline_1.sparklinePath)(scaleVals.length > values.length ? values.concat() : values, W, H, 3);
        // When guides extend the scale, rescale the path against the combined range so both agree.
        const pathScaled = guideVals.length ? rescaledPath(values, scaleVals, W, H, 3) : path;
        const lastX = values.length === 1 ? W / 2 : W - 3;
        const lastY = (0, sparkline_1.sparklineY)(guideVals.length ? scaleVals : values, stats.current, H, 3) ?? H / 2;
        return `<div class="delta ${bad ? 'delta-bad' : ''}">
  <div class="delta-head"><span class="delta-name" title="${(0, html_1.esc)(name)}">${(0, html_1.esc)(label)}</span><span class="delta-current ${trendCls}">${(0, html_1.esc)((0, sparkline_1.formatMetric)(stats.current, fmt))} ${(0, html_1.icon)(bad ? 'warning' : trendIcon)}</span></div>
  <svg class="sparkline-svg ${trendCls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="${(0, html_1.esc)(label)} trend">
    ${guides}
    <path class="sparkline-area" d="${pathScaled} L ${lastX.toFixed(1)},${H} L 3,${H} Z"/>
    <path class="sparkline" d="${pathScaled}"/>
    <circle class="sparkline-dot" cx="${lastX.toFixed(1)}" cy="${lastY.toFixed(1)}" r="2.5"/>
  </svg>
  <div class="delta-stats muted small">
    <span>min ${(0, html_1.esc)((0, sparkline_1.formatMetric)(stats.min, fmt))}</span><span>max ${(0, html_1.esc)((0, sparkline_1.formatMetric)(stats.max, fmt))}</span>
    <span>Δ ${stats.change >= 0 ? '+' : ''}${(0, html_1.esc)((0, sparkline_1.formatMetric)(stats.change, fmt))}</span>
    ${thr ? `<span title="Threshold">${typeof thr.min === 'number' ? `≥ ${(0, html_1.esc)((0, sparkline_1.formatMetric)(thr.min, fmt))}` : ''}${typeof thr.min === 'number' && typeof thr.max === 'number' ? ' · ' : ''}${typeof thr.max === 'number' ? `≤ ${(0, html_1.esc)((0, sparkline_1.formatMetric)(thr.max, fmt))}` : ''}</span>` : ''}
    <span>${pts.length} pts · ${(0, html_1.esc)((0, time_1.relativeTime)(last?.date, now))}</span>
  </div>
</div>`;
    }).join('');
    const aside = outCount ? `<span class="status-fail">${outCount} out of range</span>` : '';
    return (0, html_1.section)('deltaTracker', 'Delta Tracker', `<div class="delta-grid">${cards}</div>`, { ...opts, aside });
}
/** Path for `values` drawn on the scale of `scaleVals` (which contains the values plus guides). */
function rescaledPath(values, scaleVals, w, h, pad) {
    const min = Math.min(...scaleVals);
    const max = Math.max(...scaleVals);
    const span = max - min || 1;
    const innerW = w - pad * 2;
    const innerH = h - pad * 2;
    const pts = values.map((val, i) => {
        const x = values.length === 1 ? pad + innerW / 2 : pad + (i / (values.length - 1)) * innerW;
        const y = pad + innerH - ((val - min) / span) * innerH;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    if (pts.length === 1) {
        const [x, y] = pts[0].split(',').map(Number);
        return `M ${(x - 4).toFixed(1)},${y} L ${(x + 4).toFixed(1)},${y}`;
    }
    return `M ${pts[0]} L ${pts.slice(1).join(' ')}`;
}
//# sourceMappingURL=deltaTracker.js.map