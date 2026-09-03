"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderSections = renderSections;
const summary_1 = require("./summary");
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
    const parts = [];
    const narrow = ctx.surface === 'sidebar';
    const enabled = (id) => settings.sections[id] && (!narrow || settings.sidebarSections.length === 0 || settings.sidebarSections.includes(id));
    const collapsed = new Set(ctx.collapsed ?? []);
    const o = (id) => ({ collapsed: collapsed.has(id), collapsible: settings.dashboard.collapsible });
    if (data.readErrors.length) {
        parts.push(`<div class="read-errors">${(0, html_1.icon)('info')} ${data.readErrors.map(html_1.esc).join('<br>')}</div>`);
    }
    for (const id of settings.sectionOrder) {
        if (!enabled(id))
            continue;
        switch (id) {
            case 'summary':
                parts.push((0, summary_1.renderSummary)(data, settings, ctx.now));
                break;
            case 'activeTask':
                parts.push((0, activeTask_1.renderActiveTask)(data, settings, ctx.now, o(id)));
                break;
            case 'warnings':
                parts.push((0, warnings_1.renderWarnings)(data, o(id)));
                break;
            case 'lastCompleted':
                parts.push((0, lastCompleted_1.renderLastCompleted)(data, settings, ctx.now, o(id)));
                break;
            case 'quickActions':
                parts.push((0, quickActions_1.renderQuickActions)(data, settings, ctx.now, ctx.trusted, o(id)));
                break;
            case 'processCalendar':
                parts.push((0, processCalendar_1.renderProcessCalendar)(data, settings, ctx.now, o(id), narrow));
                break;
            case 'deltaTracker':
                parts.push((0, deltaTracker_1.renderDeltaTracker)(data, settings, ctx.now, o(id)));
                break;
            case 'runHistory':
                parts.push((0, runHistory_1.renderRunHistory)(data, settings, o(id)));
                break;
            case 'scriptHealth':
                parts.push((0, scriptHealth_1.renderScriptHealth)(data, settings, ctx.now, o(id)));
                break;
            case 'accessMap':
                parts.push((0, accessMapSummary_1.renderAccessMap)(data, settings, ctx.now, ctx.surface, o(id)));
                break;
        }
    }
    if (parts.filter(Boolean).length === 0) {
        parts.push(`<div class="empty">Every section is switched off. <button class="link-btn" data-msg="sections">${(0, html_1.icon)('checklist')}Choose sections</button></div>`);
    }
    return parts.filter(Boolean).join('\n');
}
//# sourceMappingURL=dashboard.js.map