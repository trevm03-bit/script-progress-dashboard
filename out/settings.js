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
function readSettings() {
    const c = vscode.workspace.getConfiguration('scriptProgress');
    const num = (key, def, min) => {
        const v = c.get(key, def);
        return typeof v === 'number' && isFinite(v) && v >= min ? v : def;
    };
    return {
        logsPath: c.get('logsPath', 'logs') || 'logs',
        refreshInterval: num('refreshInterval', 2000, 500),
        staleRunningMinutes: num('staleRunningMinutes', 30, 1),
        statusBarEnabled: c.get('statusBar.enabled', true),
        sections: {
            activeTask: c.get('sections.activeTask', true),
            warnings: c.get('sections.warnings', true),
            lastCompleted: c.get('sections.lastCompleted', true),
            runHistory: c.get('sections.runHistory', true),
            processCalendar: c.get('sections.processCalendar', false),
            quickActions: c.get('sections.quickActions', false),
            deltaTracker: c.get('sections.deltaTracker', false),
            scriptHealth: c.get('sections.scriptHealth', false),
            accessMap: c.get('sections.accessMap', false),
        },
        runHistoryMaxRows: num('runHistory.maxRows', 15, 1),
        processes: (c.get('processCalendar.processes', []) || []).filter(p => p && p.name),
        buttons: (c.get('quickActions.buttons', []) || []).filter(b => b && b.label && b.command),
        deltaMetrics: (c.get('deltaTracker.metrics', []) || []).filter(m => typeof m === 'string' && m),
        staleHours: num('scriptHealth.staleHours', 168, 1),
        accessMapMaxNodes: num('accessMap.maxNodes', 150, 10),
    };
}
//# sourceMappingURL=settings.js.map