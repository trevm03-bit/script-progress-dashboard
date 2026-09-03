"use strict";
// Shared shapes. The JSON files written by python/progress.py (and reporters/progress.js) are the
// contract; these interfaces describe them exactly. Nothing here imports 'vscode', so the pure
// modules (logic/, render/) can be unit-tested with plain Node.
Object.defineProperty(exports, "__esModule", { value: true });
exports.SECTION_TITLES = exports.ALL_SECTIONS = void 0;
exports.ALL_SECTIONS = [
    'summary', 'activeTask', 'warnings', 'lastCompleted', 'quickActions',
    'processCalendar', 'deltaTracker', 'runHistory', 'scriptHealth', 'accessMap',
];
exports.SECTION_TITLES = {
    summary: 'Summary strip',
    activeTask: 'Active Task',
    warnings: 'Warnings',
    lastCompleted: 'Last Completed',
    quickActions: 'Quick Actions',
    processCalendar: 'Process Calendar',
    deltaTracker: 'Delta Tracker',
    runHistory: 'Run History',
    scriptHealth: 'Script Health',
    accessMap: 'Access Map',
};
//# sourceMappingURL=types.js.map