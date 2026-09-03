"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderSections = renderSections;
const activeTask_1 = require("./activeTask");
const warnings_1 = require("./warnings");
const lastCompleted_1 = require("./lastCompleted");
const runHistory_1 = require("./runHistory");
const processCalendar_1 = require("./processCalendar");
const quickActions_1 = require("./quickActions");
const deltaTracker_1 = require("./deltaTracker");
const scriptHealth_1 = require("./scriptHealth");
const accessMapSummary_1 = require("./accessMapSummary");
const html_1 = require("./html");
function renderSections(data, settings, ctx) {
    const s = settings.sections;
    const parts = [];
    if (data.readErrors.length) {
        parts.push(`<div class="read-errors">${(0, html_1.icon)('info')} ${data.readErrors.map(html_1.esc).join('<br>')}</div>`);
    }
    // Order follows the spec's getHtml(): task, warnings, last completed, quick actions,
    // calendar, deltas, history, health — then the map last because it is the tallest.
    if (s.activeTask)
        parts.push((0, activeTask_1.renderActiveTask)(data, settings, ctx.now));
    if (s.warnings)
        parts.push((0, warnings_1.renderWarnings)(data));
    if (s.lastCompleted)
        parts.push((0, lastCompleted_1.renderLastCompleted)(data, ctx.now));
    if (s.quickActions)
        parts.push((0, quickActions_1.renderQuickActions)(settings, ctx.trusted));
    if (s.processCalendar)
        parts.push((0, processCalendar_1.renderProcessCalendar)(data, settings, ctx.now));
    if (s.deltaTracker)
        parts.push((0, deltaTracker_1.renderDeltaTracker)(data, settings, ctx.now));
    if (s.runHistory)
        parts.push((0, runHistory_1.renderRunHistory)(data, settings));
    if (s.scriptHealth)
        parts.push((0, scriptHealth_1.renderScriptHealth)(data, settings, ctx.now));
    if (s.accessMap)
        parts.push((0, accessMapSummary_1.renderAccessMap)(data, settings, ctx.now, ctx.surface));
    if (parts.length === 0) {
        parts.push(`<div class="empty">Every section is switched off. Enable some under Settings → Script Progress Dashboard.</div>`);
    }
    return parts.join('\n');
}
//# sourceMappingURL=dashboard.js.map