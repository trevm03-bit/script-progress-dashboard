"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderSummary = renderSummary;
const summary_1 = require("../logic/summary");
const time_1 = require("../logic/time");
const html_1 = require("./html");
function renderSummary(data, settings, now) {
    const f = (0, summary_1.summaryFacts)(data, settings, now);
    const tiles = [];
    const tile = (value, label, cls = '', title = '') => tiles.push(`<div class="tile ${cls}" title="${(0, html_1.esc)(title)}"><div class="tile-v">${value}</div><div class="tile-l">${(0, html_1.esc)(label)}</div></div>`);
    if (f.runningCount)
        tile(`${(0, html_1.icon)('sync~spin')} ${f.runningCount}`, 'running', 'tile-running');
    if (f.stalledCount)
        tile(`${(0, html_1.icon)('warning')} ${f.stalledCount}`, f.stalledCount === 1 ? 'stalled or exited' : 'stalled / exited', 'tile-warn');
    tile(String(f.runsToday), 'runs today');
    tile(String(f.failedToday), 'failed today', f.failedToday ? 'tile-bad' : '');
    tile(String(f.warningsToday), 'warnings today', f.warningsToday ? 'tile-warn' : '');
    if (settings.sections.processCalendar && settings.processes.length) {
        if (f.overdue.length)
            tile(`${(0, html_1.icon)('close')} ${f.overdue.length}`, 'overdue', 'tile-bad', f.overdue.join(', '));
        if (f.nextDue)
            tile((0, html_1.esc)(f.nextDue.text.replace(/^due /, '')), `next: ${f.nextDue.label}`, '', `${f.nextDue.label} ${f.nextDue.text}`);
    }
    if (settings.sections.scriptHealth && f.staleScripts.length)
        tile(String(f.staleScripts.length), 'stale scripts', 'tile-warn', f.staleScripts.join(', '));
    if (Object.keys(settings.deltas.thresholds || {}).length)
        tile(String(f.metricsOutOfRange.length), 'metrics out of range', f.metricsOutOfRange.length ? 'tile-bad' : 'tile-ok', f.metricsOutOfRange.join(', '));
    if (f.lastRun && !f.runningCount)
        tile(`${(0, html_1.icon)(f.lastRun.success ? 'check' : 'error')} ${(0, html_1.esc)((0, time_1.formatDuration)(f.lastRun.elapsed))}`, `last run · ${(0, time_1.relativeTime)(f.lastRun.date, now)}`, f.lastRun.success ? 'tile-ok' : 'tile-bad', f.lastRun.task);
    return `<section class="strip" data-section="summary"><div class="tiles">${tiles.join('')}</div></section>`;
}
//# sourceMappingURL=summary.js.map