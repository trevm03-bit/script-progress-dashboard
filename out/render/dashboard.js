"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderSections = renderSections;
// Assembles every enabled section into the HTML that goes inside the webview's #sections div,
// in the configured order, honouring the sidebar subset and collapsed state.
// Pure: no vscode import, so the whole page can be rendered in a test from fixture data.
const types_1 = require("../types");
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
const timeline_1 = require("./timeline");
const metricsExplorer_1 = require("./metricsExplorer");
const warningTrends_1 = require("./warningTrends");
const pendingActions_1 = require("./pendingActions");
const impact_1 = require("./impact");
const html_1 = require("./html");
function renderSections(data, settings, ctx) {
    const parts = [];
    const narrow = ctx.surface === 'sidebar';
    const enabled = (id) => settings.sections[id] && (!narrow || settings.sidebarSections.length === 0 || settings.sidebarSections.includes(id));
    const collapsed = new Set(ctx.collapsed ?? []);
    const o = (id) => ({ collapsed: collapsed.has(id), collapsible: settings.dashboard.collapsible, icon: types_1.SECTION_ICONS[id], identity: ctx.identity });
    // Before anything has ever reported, eight empty cards is a worse answer than one clear one.
    // This is the first thing a Marketplace installer sees, and the sections have nothing to say
    // yet by definition — so say what to do instead of showing eight ways of saying "nothing".
    // Every source of content, not just history: track_delta / impact / access all write the
    // moment they are called, so a run killed before complete() leaves real data with no history
    // row — and hiding it behind "nothing has reported yet" would be a plain falsehood.
    const nothingEverReported = !data.progress
        && data.tasks.length === 0
        && data.history.length === 0
        && Object.keys(data.deltas ?? {}).length === 0
        && Object.keys(data.impact ?? {}).length === 0
        && !(data.access?.nodes?.length);
    if (nothingEverReported && !data.readErrors.length) {
        const where = data.logsDirExists ? `Watching <code>${(0, html_1.esc)(data.logsDir)}</code>.` : `It will watch <code>${(0, html_1.esc)(data.logsDir)}</code>, which does not exist yet.`;
        return `<div class="empty-state">
  <div class="es-icon">${(0, html_1.icon)('pulse')}</div>
  <div class="es-title">No script has reported yet</div>
  <div class="es-text">Add five lines to a script and it appears here — live progress, run history, and what each run found.<br>${where}</div>
  <div class="es-actions">
    <button class="btn" data-msg="simulate">${(0, html_1.icon)('beaker')}<span>Simulate a demo run</span></button>
    <button class="btn btn-secondary" data-msg="walkthrough">${(0, html_1.icon)('book')}<span>Getting started</span></button>
    <button class="btn btn-secondary" data-msg="layout">${(0, html_1.icon)('layout')}<span>Choose a layout</span></button>
  </div>
</div>`;
    }
    if (data.readErrors.length) {
        parts.push(`<div class="read-errors">${(0, html_1.icon)('info')} ${data.readErrors.map(html_1.esc).join('<br>')}</div>`);
    }
    const drawn = new Set();
    for (const id of settings.sectionOrder) {
        if (!enabled(id) || drawn.has(id))
            continue;
        drawn.add(id);
        switch (id) {
            case 'summary':
                parts.push((0, summary_1.renderSummary)(data, settings, ctx.now, narrow));
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
            case 'timeline':
                parts.push((0, timeline_1.renderTimeline)(data, settings, ctx.now, o(id), narrow));
                break;
            case 'deltaTracker':
                parts.push((0, deltaTracker_1.renderDeltaTracker)(data, settings, ctx.now, o(id)));
                break;
            case 'metrics':
                parts.push((0, metricsExplorer_1.renderMetricsExplorer)(data, settings, ctx.now, o(id), narrow));
                break;
            case 'runHistory':
                parts.push((0, runHistory_1.renderRunHistory)(data, settings, o(id)));
                break;
            case 'warningTrends':
                parts.push((0, warningTrends_1.renderWarningTrends)(data, settings, ctx.now, o(id), narrow));
                break;
            case 'scriptHealth':
                parts.push((0, scriptHealth_1.renderScriptHealth)(data, settings, ctx.now, o(id)));
                break;
            case 'accessMap':
                parts.push((0, accessMapSummary_1.renderAccessMap)(data, settings, ctx.now, ctx.surface, o(id), ctx.graph));
                break;
            case 'pendingActions':
                parts.push((0, pendingActions_1.renderPendingActions)(data, settings, ctx.now, o(id)));
                break;
            case 'impact':
                parts.push((0, impact_1.renderImpact)(data, settings, ctx.now, o(id)));
                break;
        }
    }
    const attempted = settings.sectionOrder.some(enabled);
    // Two different empty states, because they need two different fixes. When sections ARE enabled
    // but the sidebar's own allow-list hides all of them, "every section is switched off" is simply
    // untrue - the panel is showing thirteen of them at that moment - and the button it offered
    // opened the wrong setting.
    const narrowFilterHidesAll = narrow && !attempted
        && settings.sidebarSections.length > 0 && settings.sectionOrder.some(id => settings.sections[id]);
    if (narrowFilterHidesAll) {
        parts.push(`<div class="empty-state"><div class="es-icon">${(0, html_1.icon)('layout')}</div><div class="es-title">Nothing is on the sidebar list</div><div class="es-text">Sections are switched on, but <code>dashboard.sidebarSections</code> is limiting the sidebar to a set that is all hidden. Clear it to show everything here.</div><button class="btn" data-msg="settings">${(0, html_1.icon)('settings-gear')}<span>Open settings</span></button></div>`);
    }
    else if (!attempted) {
        parts.push(`<div class="empty-state"><div class="es-icon">${(0, html_1.icon)('layout')}</div><div class="es-title">Every section is switched off</div><div class="es-text">Pick the ones you want to see.</div><button class="btn" data-msg="sections">${(0, html_1.icon)('checklist')}<span>Choose sections</span></button></div>`);
    }
    else if (parts.filter(Boolean).length === 0) {
        parts.push(`<div class="empty-state"><div class="es-icon">${(0, html_1.icon)('inbox')}</div><div class="es-title">Nothing to show yet</div><div class="es-text">The enabled sections are empty.</div></div>`);
    }
    return parts.filter(Boolean).join('\n');
}
//# sourceMappingURL=dashboard.js.map