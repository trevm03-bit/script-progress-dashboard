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
exports.activate = activate;
exports.resolveLogsDir = resolveLogsDir;
exports.deactivate = deactivate;
// Entry point. Wires settings, the file reader, the watcher + poll, the status bar,
// the sidebar view, the editor panel and the commands together.
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const dataReader_1 = require("./dataReader");
const settings_1 = require("./settings");
const statusBar_1 = require("./statusBar");
const dashboardView_1 = require("./dashboardView");
const dashboardPanel_1 = require("./dashboardPanel");
const time_1 = require("./logic/time");
function activate(context) {
    let settings = (0, settings_1.readSettings)();
    const reader = new dataReader_1.DataReader(resolveLogsDir(settings));
    let data = reader.readAll();
    const state = {
        getData: () => data,
        getSettings: () => settings,
    };
    const statusBar = new statusBar_1.StatusBarManager();
    const view = new dashboardView_1.DashboardViewProvider(context.extensionUri, state);
    context.subscriptions.push(statusBar, vscode.window.registerWebviewViewProvider(dashboardView_1.DashboardViewProvider.viewId, view));
    // ---- refresh pipeline -------------------------------------------------------------
    let refreshTimer;
    const refresh = (force = false) => {
        data = reader.readAll();
        statusBar.update(data, settings);
        view.refresh(force);
        dashboardPanel_1.DashboardPanel.current?.refresh(force);
    };
    // Many watcher events can land within a few ms of each other (four files, tmp+rename);
    // coalesce them so we read once.
    const scheduleRefresh = () => {
        if (refreshTimer)
            return;
        refreshTimer = setTimeout(() => { refreshTimer = undefined; refresh(); }, 60);
    };
    // ---- file watcher (immediate) + poll (safety net) ---------------------------------
    let watcher;
    const startWatcher = () => {
        watcher?.dispose();
        watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(reader.logsDir), '*.json'));
        watcher.onDidChange(scheduleRefresh);
        watcher.onDidCreate(scheduleRefresh);
        watcher.onDidDelete(scheduleRefresh);
        context.subscriptions.push(watcher);
    };
    startWatcher();
    let pollTimer;
    let lastMtime = reader.latestMtime();
    let lastPoll = 0;
    let lastFullRefresh = Date.now();
    const startPoll = () => {
        if (pollTimer)
            clearInterval(pollTimer);
        // One-second tick. Three reasons to re-render, cheapest first:
        //   1. a file changed and the watcher missed it (checked every refreshInterval ms),
        //   2. a task is running: elapsed time must tick and a stall must show up on time,
        //   3. once a minute regardless, so "3m ago" style text stays honest.
        pollTimer = setInterval(() => {
            const now = Date.now();
            if (now - lastPoll >= settings.refreshInterval) {
                lastPoll = now;
                const m = reader.latestMtime();
                if (m !== lastMtime) {
                    lastMtime = m;
                    lastFullRefresh = now;
                    refresh();
                    return;
                }
            }
            const running = data.progress?.status === 'running';
            if (running || now - lastFullRefresh >= 60000) {
                lastFullRefresh = now;
                refresh();
            }
        }, 1000);
    };
    startPoll();
    context.subscriptions.push({ dispose: () => { if (pollTimer)
            clearInterval(pollTimer); if (refreshTimer)
            clearTimeout(refreshTimer); } });
    // ---- settings changes -------------------------------------------------------------
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (!e.affectsConfiguration('scriptProgress'))
            return;
        settings = (0, settings_1.readSettings)();
        const dir = resolveLogsDir(settings);
        if (dir !== reader.logsDir) {
            reader.setLogsDir(dir);
            startWatcher();
        }
        startPoll();
        refresh(true);
    }), vscode.workspace.onDidChangeWorkspaceFolders(() => {
        settings = (0, settings_1.readSettings)();
        reader.setLogsDir(resolveLogsDir(settings));
        startWatcher();
        refresh(true);
    }), vscode.workspace.onDidGrantWorkspaceTrust(() => refresh(true)));
    // ---- commands ---------------------------------------------------------------------
    context.subscriptions.push(vscode.commands.registerCommand('scriptProgress.openPanel', () => {
        dashboardPanel_1.DashboardPanel.createOrShow(context.extensionUri, state);
    }), vscode.commands.registerCommand('scriptProgress.refresh', () => refresh(true)), vscode.commands.registerCommand('scriptProgress.openLogsFolder', async () => {
        if (!fs.existsSync(reader.logsDir)) {
            const pick = await vscode.window.showWarningMessage(`Logs folder does not exist yet: ${reader.logsDir}`, 'Create it', 'Open Settings');
            if (pick === 'Create it')
                fs.mkdirSync(reader.logsDir, { recursive: true });
            else if (pick === 'Open Settings')
                await vscode.commands.executeCommand('workbench.action.openSettings', 'scriptProgress.logsPath');
            else
                return;
        }
        const target = fs.existsSync(path.join(reader.logsDir, dataReader_1.FILES.progress))
            ? vscode.Uri.file(path.join(reader.logsDir, dataReader_1.FILES.progress))
            : vscode.Uri.file(reader.logsDir);
        await vscode.commands.executeCommand('revealFileInOS', target);
    }), vscode.commands.registerCommand('scriptProgress.showHistory', () => {
        const channel = getHistoryChannel();
        channel.clear();
        const runs = data.history.slice().sort((a, b) => ((0, time_1.parseIso)(b.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.date)?.getTime() ?? 0));
        channel.appendLine(`Run history — ${runs.length} run(s) from ${path.join(reader.logsDir, dataReader_1.FILES.history)}`);
        channel.appendLine('');
        for (const run of runs) {
            const tag = run.success ? 'PASS' : 'FAIL';
            const warn = run.warnings ? ` | ${run.warnings} warning(s)` : '';
            channel.appendLine(`[${tag}] ${(0, time_1.dateTime)(run.date)} | ${run.task} | ${(0, time_1.formatDuration)(run.elapsed)}${warn} | ${run.summary ?? ''}`);
        }
        channel.show(true);
    }));
    refresh(true);
}
let historyChannel;
function getHistoryChannel() {
    if (!historyChannel)
        historyChannel = vscode.window.createOutputChannel('Script Progress History');
    return historyChannel;
}
/** Absolute paths are used as-is; relative ones resolve against the first workspace folder. */
function resolveLogsDir(settings) {
    const p = settings.logsPath;
    if (path.isAbsolute(p))
        return path.normalize(p);
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (ws)
        return path.normalize(path.join(ws, p));
    // No folder open: fall back to the home directory so the extension still activates cleanly.
    return path.normalize(path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), p));
}
function deactivate() {
    historyChannel?.dispose();
    historyChannel = undefined;
}
//# sourceMappingURL=extension.js.map