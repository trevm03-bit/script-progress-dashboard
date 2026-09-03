"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderWarningTrends = renderWarningTrends;
const warningTrends_1 = require("../logic/warningTrends");
const time_1 = require("../logic/time");
const html_1 = require("./html");
const CHART_W = 280;
const CHART_H = 44;
const GAP = 2;
const TREND_ICON = { rising: 'arrow-up', falling: 'arrow-down', flat: 'arrow-right' };
const TREND_LABEL = {
    rising: 'more often than earlier in the window',
    falling: 'less often than earlier in the window',
    flat: 'about as often as earlier in the window',
};
/** Bars for the per-day counts; the most recent day is highlighted. */
function chart(days) {
    const max = Math.max(1, ...days.map(d => d.count));
    const slot = CHART_W / days.length;
    const barW = Math.max(1, slot - GAP);
    const bars = days.map((d, i) => {
        const h = d.count === 0 ? 0 : Math.max(2, (d.count / max) * (CHART_H - 4));
        const x = i * slot + (slot - barW) / 2;
        const y = CHART_H - h;
        const cls = `wt-bar${i === days.length - 1 ? ' wt-bar-last' : ''}${d.count === 0 ? ' wt-bar-zero' : ''}`;
        const title = `${d.date}: ${d.count} warning${d.count === 1 ? '' : 's'}`;
        // A zero day still gets a hairline so the axis reads as continuous and stays hoverable.
        return `<rect class="${cls}" x="${x.toFixed(1)}" y="${(d.count === 0 ? CHART_H - 1 : y).toFixed(1)}" width="${barW.toFixed(1)}" height="${(d.count === 0 ? 1 : h).toFixed(1)}"><title>${(0, html_1.esc)(title)}</title></rect>`;
    }).join('');
    const first = days[0];
    const mid = days[Math.floor((days.length - 1) / 2)];
    const last = days[days.length - 1];
    const labels = days.length > 2 && mid !== first && mid !== last
        ? [first, mid, last]
        : [first, last].filter((d, i, a) => a.indexOf(d) === i);
    return `<svg class="wt-chart" viewBox="0 0 ${CHART_W} ${CHART_H}" preserveAspectRatio="none" role="img" aria-label="Warnings per day">${bars}</svg>
<div class="wt-days muted small">${labels.map(d => `<span>${(0, html_1.esc)(d.label)}</span>`).join('')}</div>`;
}
function group(g, now) {
    const tasks = g.tasks.map(t => (0, html_1.chip)('task', t, 'wt-task')).join('');
    return `<li class="wt-group">
  <span class="wt-count" title="${g.count} occurrence${g.count === 1 ? '' : 's'} in this window">${g.count}</span>
  <div class="wt-body">
    <div class="wt-msg" title="${(0, html_1.esc)(g.pattern)}">${(0, html_1.esc)(g.example)}</div>
    <div class="wt-meta muted small">
      <span class="wt-tasks">${tasks}</span>
      <span class="wt-when">first ${(0, html_1.esc)((0, time_1.relativeTime)(g.firstSeen, now))} · last ${(0, html_1.esc)((0, time_1.relativeTime)(g.lastSeen, now))}</span>
      <span class="wt-trend wt-${g.trend}" title="${(0, html_1.esc)(TREND_LABEL[g.trend])}">${(0, html_1.icon)(TREND_ICON[g.trend])}${g.trend}</span>
    </div>
  </div>
</li>`;
}
function renderWarningTrends(data, settings, now, opts, narrow) {
    const model = (0, warningTrends_1.warningTrendsModel)(data, settings, now);
    if (model.total === 0) {
        const body = (0, html_1.empty)(`No warnings in the last ${model.windowDays} day${model.windowDays === 1 ? '' : 's'}.`);
        return (0, html_1.section)('warningTrends', 'Warning Trends', body, opts);
    }
    const groups = narrow ? model.groups.slice(0, 3) : model.groups;
    const body = `${narrow ? '' : chart(model.days)}
<ul class="wt-list">${groups.map(g => group(g, now)).join('')}</ul>`;
    const aside = `${model.total} in ${model.windowDays} day${model.windowDays === 1 ? '' : 's'}`;
    return (0, html_1.section)('warningTrends', 'Warning Trends', body, { ...opts, aside });
}
//# sourceMappingURL=warningTrends.js.map