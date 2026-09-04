"use strict";
// Shared shapes. The JSON files written by python/progress.py (and reporters/progress.js) are the
// contract; these interfaces describe them exactly. Nothing here imports 'vscode', so the pure
// modules (logic/, render/) can be unit-tested with plain Node.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SECTION_ICONS = exports.SECTION_TITLES = exports.ALL_SECTIONS = void 0;
exports.ALL_SECTIONS = [
    'summary', 'activeTask', 'pendingActions', 'warnings', 'lastCompleted', 'quickActions',
    'processCalendar', 'timeline', 'deltaTracker', 'metrics', 'runHistory',
    'warningTrends', 'scriptHealth', 'impact', 'accessMap',
];
exports.SECTION_TITLES = {
    summary: 'Summary strip',
    activeTask: 'Active Task',
    warnings: 'Warnings',
    lastCompleted: 'Last Completed',
    quickActions: 'Quick Actions',
    processCalendar: 'Process Calendar',
    timeline: 'Run Timeline',
    deltaTracker: 'Delta Tracker',
    metrics: 'Metrics Explorer',
    runHistory: 'Run History',
    warningTrends: 'Warning Trends',
    scriptHealth: 'Script Health',
    accessMap: 'Access Map',
    pendingActions: 'Pending Actions',
    impact: 'Impact Summary',
};
/** Codicon per section, for titles and pickers. */
exports.SECTION_ICONS = {
    summary: 'dashboard', activeTask: 'pulse', warnings: 'warning', lastCompleted: 'check-all', quickActions: 'play',
    processCalendar: 'calendar', timeline: 'timeline-view-icon', deltaTracker: 'graph-line', metrics: 'table', runHistory: 'history',
    warningTrends: 'flame', scriptHealth: 'heart', accessMap: 'graph',
    pendingActions: 'checklist', impact: 'graph-scatter',
};
//# sourceMappingURL=types.js.map