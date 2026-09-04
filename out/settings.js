"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.readSettings = readSettings;
// One typed snapshot of every scriptProgress.* setting. Read it fresh on each refresh so
// changes in Settings apply without a reload.
const vscode = __importStar(require("vscode"));
const types_1 = require("./types");
const validate_1 = require("./logic/validate");
function readSettings() {
    const c = vscode.workspace.getConfiguration('scriptProgress');
    const num = (key, def, min, max = Infinity) => {
        const v = c.get(key, def);
        return typeof v === 'number' && isFinite(v) && v >= min && v <= max ? v : def;
    };
    const str = (key, def, allowed) => {
        const v = c.get(key, def);
        return allowed.includes(v) ? v : def;
    };
    const bool = (key, def) => { const v = c.get(key, def); return typeof v === 'boolean' ? v : def; };
    const sectionList = (key) => (c.get(key, []) || []).filter((s) => types_1.ALL_SECTIONS.includes(s));
    const sections = {};
    const defaults = {
        summary: true, activeTask: true, warnings: true, lastCompleted: true, runHistory: true, timeline: true,
        quickActions: false, processCalendar: false, deltaTracker: false, metrics: false, warningTrends: false, scriptHealth: false, accessMap: false,
    };
    for (const s of types_1.ALL_SECTIONS)
        sections[s] = c.get(`sections.${s}`, defaults[s]);
    const order = sectionList('dashboard.sectionOrder');
    const sectionOrder = [...order, ...types_1.ALL_SECTIONS.filter(s => !order.includes(s))];
    // Validate the RAW values before the filters below silently drop the malformed ones.
    const problems = (0, validate_1.validateSettings)({
        buttons: c.get('quickActions.buttons'),
        processes: c.get('processCalendar.processes'),
        deltaMetrics: c.get('deltaTracker.metrics'),
        deltaThresholds: c.get('deltaTracker.thresholds'),
    });
    return {
        problems,
        logsPath: c.get('logsPath', 'logs') || 'logs',
        refreshInterval: num('refreshInterval', 2000, 500),
        staleRunningMinutes: num('staleRunningMinutes', 30, 1),
        sections,
        sectionOrder,
        sidebarSections: sectionList('dashboard.sidebarSections'),
        dashboard: {
            collapsible: bool('dashboard.collapsible', true),
            density: str('dashboard.density', 'comfortable', ['comfortable', 'compact']),
        },
        activeTask: {
            showLog: bool('activeTask.showLog', true),
            logLines: num('activeTask.logLines', 6, 1, 50),
            showMetrics: bool('activeTask.showMetrics', true),
            showArtifacts: bool('activeTask.showArtifacts', true),
        },
        runHistory: {
            maxRows: num('runHistory.maxRows', 15, 1),
            filters: bool('runHistory.filters', true),
            detail: bool('runHistory.detail', true),
            trend: bool('runHistory.trend', true),
            anomalies: bool('runHistory.anomalies', true),
            anomalyFactor: num('runHistory.anomalyFactor', 2, 1.1),
        },
        timeline: {
            windowHours: num('timeline.windowHours', 24, 1),
            showFailed: bool('timeline.showFailed', true),
        },
        metricsExplorer: {
            maxRuns: num('metricsExplorer.maxRuns', 12, 2, 100),
            metrics: (c.get('metricsExplorer.metrics', []) || []).filter(m => typeof m === 'string' && m),
        },
        warningTrends: {
            days: num('warningTrends.days', 14, 1, 365),
            top: num('warningTrends.top', 8, 1, 50),
        },
        processes: (c.get('processCalendar.processes', []) || []).filter(p => p && p.name),
        calendar: {
            view: str('processCalendar.view', 'both', ['list', 'grid', 'both']),
            upcoming: bool('processCalendar.upcoming', true),
        },
        buttons: (c.get('quickActions.buttons', []) || []).filter(b => b && b.label && b.command),
        quickActions: {
            runVia: str('quickActions.runVia', 'terminal', ['terminal', 'task']),
            asTasks: bool('quickActions.asTasks', true),
            contextMenu: bool('quickActions.contextMenu', true),
            disableWhileRunning: bool('quickActions.disableWhileRunning', true),
            interpreters: c.get('quickActions.interpreters', {}) || {},
        },
        deltaMetrics: (c.get('deltaTracker.metrics', []) || []).filter(m => typeof m === 'string' && m),
        deltas: {
            formats: c.get('deltaTracker.formats', {}) || {},
            thresholds: c.get('deltaTracker.thresholds', {}) || {},
            points: num('deltaTracker.points', 50, 2),
        },
        staleHours: num('scriptHealth.staleHours', 168, 1),
        health: { resultDots: num('scriptHealth.resultDots', 5, 0, 20) },
        accessMap: {
            maxNodes: num('accessMap.maxNodes', 150, 10),
            layout: str('accessMap.layout', 'force', ['force', 'radial']),
            timeWindowDays: num('accessMap.timeWindowDays', 0, 0),
            labels: str('accessMap.labels', 'auto', ['auto', 'all', 'scripts']),
            sidebarPreview: bool('accessMap.sidebarPreview', true),
            replay: bool('accessMap.replay', true),
            ambient: bool('accessMap.ambient', true),
            halos: bool('accessMap.halos', true),
            glyphs: bool('accessMap.glyphs', true),
            minimap: bool('accessMap.minimap', true),
            starfield: bool('accessMap.starfield', false),
        },
        notifications: {
            onComplete: bool('notifications.onComplete', false),
            onFail: bool('notifications.onFail', true),
            onStall: bool('notifications.onStall', true),
            onWarning: bool('notifications.onWarning', false),
            onExit: bool('notifications.onExit', true),
            onSlow: bool('notifications.onSlow', false),
            mirrorProgress: bool('notifications.mirrorProgress', false),
        },
        events: {
            file: bool('events.file', false),
        },
        statusBar: {
            enabled: bool('statusBar.enabled', true),
            idleMode: str('statusBar.idleMode', 'last', ['last', 'hidden']),
            clickAction: str('statusBar.clickAction', 'menu', ['menu', 'dashboard']),
        },
        badge: str('badge', 'running', ['running', 'failures', 'off']),
    };
}
//# sourceMappingURL=settings.js.map