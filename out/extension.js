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
// Entry point. Wires settings, the file reader, the watcher + tick, the status bar, the sidebar
// view, the editor panels, notifications, tasks and the commands together.
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const actions_1 = require("./actions");
const commands_1 = require("./commands");
const dashboardPanel_1 = require("./dashboardPanel");
const dashboardView_1 = require("./dashboardView");
const dataReader_1 = require("./dataReader");
const notifications_1 = require("./notifications");
const settings_1 = require("./settings");
const scopeCheck_1 = require("./scopeCheck");
const statusBar_1 = require("./statusBar");
const types_1 = require("./types");
const time_1 = require("./logic/time");
const COLLAPSED_KEY = 'scriptProgress.collapsedSections';
function activate(context) {
    let settings = (0, settings_1.readSettings)();
    const reader = new dataReader_1.DataReader(resolveLogsDir(settings));
    // Settings placed where this extension cannot read them look identical to no settings at all.
    // Say so once, rather than letting the user re-do configuration that was already correct.
    void (0, scopeCheck_1.warnAboutIgnoredSettings)(context);
    let data = reader.readAll();
    const notifier = new notifications_1.Notifier();
    const statusBar = new statusBar_1.StatusBarManager();
    const runner = new actions_1.ActionRunner(() => settings, {
        onExit: (overlay, label) => {
            // Attach the exit ONLY to the task the button named (prefix match, like the calendar and
            // the buttons themselves). An unnamed button's exit is reported against its label alone —
            // never pinned to "whatever happens to be running".
            // Resolve the button's task name to the ONE running script it belongs to, and store that.
            // A button named "Nightly" is a prefix of "Nightly Load" AND "Nightly Refresh"; left
            // unresolved, one process ending reported both as crashed. If the prefix is ambiguous we
            // genuinely do not know which script exited, and saying nothing beats blaming the wrong one.
            // 🔴 Two rules, and the previous guard got both wrong in opposite directions.
            //
            // 'stalled' is not 'gone'. Requiring taskState() === 'running' threw the exit away for
            // exactly the long jobs an exit overlay exists for: a backfill that does one long step
            // without calling step() is already stale by the time the terminal exit arrives, so the
            // dashboard went on saying "Stalled — no update for 45 min" while the extension had been
            // handed exit code 137 and knew the process was dead, and last_event.json never got the
            // `exited` event both package.json and the README promise. What disqualifies a task is
            // having already reported a FINAL state: that run is over and this exit is not its news.
            //
            // And a name prefix is not an identity. "Nightly" matches "Nightly Load" AND "Nightly
            // Refresh"; guarding only the two-or-more case left the one-sibling case, where an
            // unrelated exit still flipped a healthy, actively-reporting script to "Exited". Only a
            // run that began after we launched the command can be the run we launched. The two-second
            // grace covers the reporter writing startedAt truncated to the second.
            const launchedAt = overlay.launchedAt ? Date.parse(overlay.launchedAt) : 0;
            const matches = overlay.task
                ? data.tasks.filter(t => {
                    if (!(0, time_1.taskMatches)(t.task, overlay.task))
                        return false;
                    if (t.status === 'complete' || t.status === 'failed')
                        return false;
                    const started = t.startedAt ? Date.parse(t.startedAt) : 0;
                    return !launchedAt || !started || Number.isNaN(started) || started >= launchedAt - 2000;
                })
                : [];
            if (matches.length === 1) {
                reader.addOverlay({ ...overlay, task: matches[0].task });
                refresh(true); // the notifier sees the 'exited' transition and reports it
            }
            else if (settings.notifications.onExit) {
                void vscode.window.showErrorMessage(`✗ "${label}" exited with code ${overlay.exitCode}`, 'Open Dashboard')
                    .then(p => p && vscode.commands.executeCommand('scriptProgress.openPanel'));
            }
        },
    });
    const state = {
        getData: () => data,
        getSettings: () => settings,
        runner,
        getCollapsed: () => (context.globalState.get(COLLAPSED_KEY, []) || []).filter((s) => types_1.ALL_SECTIONS.includes(s)),
        setCollapsed: ids => { void context.globalState.update(COLLAPSED_KEY, ids); dashboardPanel_1.DashboardPanel.refreshAll(true); view.refresh(true); },
    };
    const view = new dashboardView_1.DashboardViewProvider(context.extensionUri, state);
    context.subscriptions.push(statusBar, notifier, runner, vscode.window.registerWebviewViewProvider(dashboardView_1.DashboardViewProvider.viewId, view), vscode.tasks.registerTaskProvider(actions_1.TASK_TYPE, { provideTasks: () => runner.provideTasks(), resolveTask: t => runner.resolveTask(t) }));
    // ---- refresh pipeline -------------------------------------------------------------
    let refreshTimer;
    const refresh = (force = false) => {
        data = reader.readAll();
        statusBar.logsDir = resolveLogsDir(settings);
        notifier.logsDir = statusBar.logsDir;
        statusBar.update(data, settings);
        notifier.update(data, settings);
        view.refresh(force);
        dashboardPanel_1.DashboardPanel.refreshAll(force);
    };
    // Many watcher events can land within a few ms of each other (files + slot files, tmp+rename);
    // coalesce them so we read once.
    const scheduleRefresh = () => {
        if (refreshTimer)
            return;
        refreshTimer = setTimeout(() => { refreshTimer = undefined; refresh(); }, 60);
    };
    // ---- file watchers (immediate) + tick (safety net) ------------------------------
    let watchers = [];
    const startWatchers = () => {
        for (const w of watchers)
            w.dispose();
        watchers = [
            vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(reader.logsDir), '*.json')),
            vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(vscode.Uri.file(path.join(reader.logsDir, 'progress')), '*.json')),
        ];
        for (const w of watchers) {
            w.onDidChange(scheduleRefresh);
            w.onDidCreate(scheduleRefresh);
            w.onDidDelete(scheduleRefresh);
        }
    };
    startWatchers();
    context.subscriptions.push({ dispose: () => { for (const w of watchers)
            w.dispose(); watchers = []; } });
    let pollTimer;
    // A non-recursive watcher over a directory that does not exist never starts and never retries,
    // and the folder not existing yet IS the first-run case. Track it so the watchers can be armed
    // the moment the first script creates it, instead of the window running on the poll all day.
    let watchedDirExisted = data.logsDirExists;
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
                if (!watchedDirExisted && data.logsDirExists) {
                    watchedDirExisted = true;
                    startWatchers();
                }
                const m = reader.latestMtime();
                if (m !== lastMtime) {
                    lastMtime = m;
                    lastFullRefresh = now;
                    refresh();
                    return;
                }
            }
            // taskState, not the raw file field. `status` stays "running" forever in a file left by a
            // script that was Ctrl-C'd, so trusting it pinned this to a full re-render every second for
            // the life of the window - while the UI itself was correctly showing "stalled".
            const running = data.tasks.some(t => (0, time_1.taskState)(t, settings.staleRunningMinutes, new Date(now), data.overlays) === 'running');
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
    // ---- settings / workspace changes -------------------------------------------------
    const reconfigure = () => {
        settings = (0, settings_1.readSettings)();
        const dir = resolveLogsDir(settings);
        if (dir !== reader.logsDir) {
            reader.setLogsDir(dir);
            startWatchers();
        }
        startPoll();
        refresh(true);
    };
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('scriptProgress'))
        reconfigure(); }), vscode.workspace.onDidChangeWorkspaceFolders(reconfigure), vscode.workspace.onDidGrantWorkspaceTrust(() => refresh(true)));
    // ---- commands ---------------------------------------------------------------------
    (0, commands_1.registerCommands)(context, {
        extensionUri: context.extensionUri,
        getData: () => data,
        getSettings: () => settings,
        logsDir: () => reader.logsDir,
        refresh,
        runner,
        getCollapsed: state.getCollapsed,
        setCollapsed: state.setCollapsed,
    });
    refresh(true);
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
    (0, commands_1.disposeCommands)();
}
//# sourceMappingURL=extension.js.map