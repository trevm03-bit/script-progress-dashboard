"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.windowText = windowText;
exports.renderTimeline = renderTimeline;
const timeline_1 = require("../logic/timeline");
const time_1 = require("../logic/time");
const html_1 = require("./html");
/** Lanes shown in the sidebar before the list is cut. */
const NARROW_LANES = 6;
/** Drawing width of a track; the SVG is stretched to the column, so these are relative units. */
const W = 1000;
const H = 24;
/** A one-second run must still be clickable/visible. */
const MIN_BAR = 4;
/** "24 hours" / "7 days" / "90 minutes" — used in the empty state and the aside. */
function windowText(hours) {
    if (hours < 1) {
        const m = Math.round(hours * 60);
        return `${m} minute${m === 1 ? '' : 's'}`;
    }
    if (hours < 48 || hours % 24 !== 0) {
        const h = Math.round(hours * 10) / 10;
        return `${h} hour${h === 1 ? '' : 's'}`;
    }
    const d = Math.round(hours / 24);
    return `${d} day${d === 1 ? '' : 's'}`;
}
/** Short form for the section aside: "last 24h" / "last 7d". */
function windowShort(hours) {
    if (hours >= 48 && hours % 24 === 0)
        return `last ${Math.round(hours / 24)}d`;
    if (hours < 1)
        return `last ${Math.round(hours * 60)}m`;
    return `last ${Math.round(hours * 10) / 10}h`;
}
function barClass(b) {
    const state = b.running ? 'tl-bar-running' : b.success ? 'tl-bar-ok' : 'tl-bar-fail';
    return `tl-bar ${state}${b.slow ? ' tl-bar-slow' : ''}${b.overSla ? ' tl-bar-sla' : ''}`;
}
function stateWord(b) {
    const base = b.running ? 'running' : b.success ? 'ok' : 'failed';
    const flags = [b.slow ? 'slow' : '', b.overSla ? 'over SLA' : ''].filter(Boolean).join(' · ');
    return flags ? `${base} · ${flags}` : base;
}
function sameLocalDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
/** "09:29–09:30" inside a day-long window; the date is added once it could be ambiguous. */
function barTimes(b, longWindow) {
    const iso = (d) => d.toISOString();
    const withDate = longWindow || !sameLocalDay(b.start, b.end);
    const fmt = (d) => (withDate ? (0, time_1.dateTime)(iso(d)) : (0, time_1.clockTime)(iso(d)));
    return `${fmt(b.start)}–${fmt(b.end)}`;
}
function barSvg(lane, longWindow) {
    const rects = lane.bars.map(b => {
        const x = b.x0 * W;
        const width = Math.max(MIN_BAR, (b.x1 - b.x0) * W);
        const left = Math.min(x, W - width);
        const tip = `${lane.task} · ${barTimes(b, longWindow)} · ${(0, time_1.formatDuration)(b.seconds)} · ${stateWord(b)}`;
        return `<rect class="${barClass(b)}" x="${left.toFixed(2)}" y="4" width="${width.toFixed(2)}" height="${H - 8}" rx="3"><title>${(0, html_1.esc)(tip)}</title></rect>`;
    }).join('');
    return `<svg class="tl-bars" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${(0, html_1.esc)(`${lane.task}: ${lane.runs} run${lane.runs === 1 ? '' : 's'}`)}">${rects}</svg>`;
}
function laneTotals(lane) {
    const parts = [`${lane.runs} run${lane.runs === 1 ? '' : 's'}`];
    if (lane.failures)
        parts.push(`${lane.failures} failed`);
    parts.push((0, time_1.formatDuration)(lane.totalSeconds));
    return (0, html_1.esc)(parts.join(' · '));
}
function renderTimeline(data, settings, now, opts, narrow) {
    const model = (0, timeline_1.timelineModel)(data, settings, now);
    const title = 'Run Timeline';
    if (model.lanes.length === 0) {
        return (0, html_1.section)('timeline', title, (0, html_1.empty)(`No runs in the last ${windowText(model.windowHours)}.`), {
            ...opts,
            aside: `<span class="muted">${(0, html_1.esc)(windowShort(model.windowHours))}</span>`,
        });
    }
    const shown = narrow ? model.lanes.slice(0, NARROW_LANES) : model.lanes;
    const hidden = model.lanes.length - shown.length;
    const longWindow = model.windowHours > 24;
    const tickLines = model.ticks
        .map(t => `<line class="tl-tick${t.major ? ' tl-tick-major' : ''}" x1="${(t.x * W).toFixed(2)}" x2="${(t.x * W).toFixed(2)}" y1="0" y2="10"/>`)
        .join('');
    // Thin the labels out: never one under the "now" marker, and only day/half-day marks in a
    // sidebar-width column where three-hourly words would collide. Each label also carries a
    // priority class (major = midnight, half = noon, minor = the rest) so timeline.css can drop
    // the lower ones with a container query when the track itself is narrow.
    let majors = 0;
    const tickLabels = model.ticks
        .filter(t => t.label && t.x <= 0.94 && (!narrow || t.major || t.at.getHours() % 12 === 0))
        .map(t => `<span class="tl-tick-lbl ${t.major ? `tl-lbl-major${majors++ % 2 ? ' tl-lbl-alt' : ''}` : t.at.getHours() % 12 === 0 ? 'tl-lbl-half' : 'tl-lbl-minor'}" style="left:${(t.x * 100).toFixed(3)}%">${(0, html_1.esc)(t.label)}</span>`)
        .join('');
    const head = `<div class="tl-name tl-head-name muted" title="${(0, html_1.esc)((0, time_1.dateTime)(model.start.toISOString()))}">${(0, html_1.esc)(longWindow ? (0, time_1.dateTime)(model.start.toISOString()) : (0, time_1.clockTime)(model.start.toISOString()))}</div>
  <div class="tl-track tl-axis">
    <svg class="tl-ticks" viewBox="0 0 ${W} 10" preserveAspectRatio="none" aria-hidden="true">${tickLines}</svg>
    <div class="tl-tick-labels">${tickLabels}<span class="tl-now-lbl">now</span></div>
  </div>${narrow ? '' : '<div class="tl-tot tl-head-tot"></div>'}`;
    const rows = shown.map(lane => `<div class="tl-name${lane.running ? ' tl-name-running' : ''}" title="${(0, html_1.esc)(lane.task)}">${(0, html_1.esc)(lane.task)}</div>
  <div class="tl-track">${barSvg(lane, longWindow)}</div>${narrow ? '' : `<div class="tl-tot muted">${laneTotals(lane)}</div>`}`).join('\n  ');
    const more = hidden > 0 ? `<div class="tl-more muted small">${(0, html_1.esc)(`+${hidden} more task${hidden === 1 ? '' : 's'}`)}</div>` : '';
    const body = `<div class="tl-wrap"><div class="tl-grid${narrow ? ' tl-narrow' : ''}">
  ${head}
  ${rows}
</div></div>${more}`;
    const runsText = `${(0, html_1.esc)(windowShort(model.windowHours))} · ${model.runs} run${model.runs === 1 ? '' : 's'}`;
    const aside = `<span class="muted">${runsText}</span>${model.failures > 0 ? `<span class="status-fail">· ${model.failures} failed</span>` : ''}`;
    return (0, html_1.section)('timeline', title, body, { ...opts, aside });
}
//# sourceMappingURL=timeline.js.map