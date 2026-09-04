// Entry point. Wires settings, the file reader, the watcher + tick, the status bar, the sidebar
// view, the editor panels, notifications, tasks and the commands together.
import * as path from 'path';
import * as vscode from 'vscode';
import { ActionRunner, TASK_TYPE } from './actions';
import { disposeCommands, registerCommands } from './commands';
import { DashboardPanel } from './dashboardPanel';
import { DashboardViewProvider } from './dashboardView';
import { StateProvider } from './dashboardHost';
import { DataReader } from './dataReader';
import { Notifier } from './notifications';
import { readSettings } from './settings';
import { warnAboutIgnoredSettings } from './scopeCheck';
import { StatusBarManager } from './statusBar';
import { ALL_SECTIONS, DashboardData, SectionId, Settings } from './types';
import { taskMatches } from './logic/time';

const COLLAPSED_KEY = 'scriptProgress.collapsedSections';

export function activate(context: vscode.ExtensionContext): void {
  let settings = readSettings();
  const reader = new DataReader(resolveLogsDir(settings));
  // Settings placed where this extension cannot read them look identical to no settings at all.
  // Say so once, rather than letting the user re-do configuration that was already correct.
  void warnAboutIgnoredSettings(context);
  let data: DashboardData = reader.readAll();
  const notifier = new Notifier();
  const statusBar = new StatusBarManager();

  const runner = new ActionRunner(() => settings, {
    onExit: (overlay, label) => {
      // Attach the exit ONLY to the task the button named (prefix match, like the calendar and
      // the buttons themselves). An unnamed button's exit is reported against its label alone —
      // never pinned to "whatever happens to be running".
      const named = overlay.task && data.tasks.some(t => taskMatches(t.task, overlay.task) && t.status === 'running');
      if (named) {
        reader.addOverlay(overlay);
        refresh(true);           // the notifier sees the 'exited' transition and reports it
      } else if (settings.notifications.onExit) {
        void vscode.window.showErrorMessage(`✗ "${label}" exited with code ${overlay.exitCode}`, 'Open Dashboard')
          .then(p => p && vscode.commands.executeCommand('scriptProgress.openPanel'));
      }
    },
  });

  const state: StateProvider = {
    getData: () => data,
    getSettings: () => settings,
    runner,
    getCollapsed: () => (context.globalState.get<string[]>(COLLAPSED_KEY, []) || []).filter((s): s is SectionId => (ALL_SECTIONS as string[]).includes(s)),
    setCollapsed: ids => { void context.globalState.update(COLLAPSED_KEY, ids); DashboardPanel.refreshAll(true); view.refresh(true); },
  };

  const view = new DashboardViewProvider(context.extensionUri, state);
  context.subscriptions.push(
    statusBar, notifier, runner,
    vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewId, view),
    vscode.tasks.registerTaskProvider(TASK_TYPE, { provideTasks: () => runner.provideTasks(), resolveTask: t => runner.resolveTask(t) }),
  );

  // ---- refresh pipeline -------------------------------------------------------------
  let refreshTimer: NodeJS.Timeout | undefined;
  const refresh = (force = false) => {
    data = reader.readAll();
    statusBar.logsDir = resolveLogsDir(settings);
    statusBar.update(data, settings);
    notifier.update(data, settings);
    view.refresh(force);
    DashboardPanel.refreshAll(force);
  };
  // Many watcher events can land within a few ms of each other (files + slot files, tmp+rename);
  // coalesce them so we read once.
  const scheduleRefresh = () => {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => { refreshTimer = undefined; refresh(); }, 60);
  };

  // ---- file watchers (immediate) + tick (safety net) ------------------------------
  let watchers: vscode.FileSystemWatcher[] = [];
  const startWatchers = () => {
    for (const w of watchers) w.dispose();
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
  context.subscriptions.push({ dispose: () => { for (const w of watchers) w.dispose(); watchers = []; } });

  let pollTimer: NodeJS.Timeout | undefined;
  let lastMtime = reader.latestMtime();
  let lastPoll = 0;
  let lastFullRefresh = Date.now();
  const startPoll = () => {
    if (pollTimer) clearInterval(pollTimer);
    // One-second tick. Three reasons to re-render, cheapest first:
    //   1. a file changed and the watcher missed it (checked every refreshInterval ms),
    //   2. a task is running: elapsed time must tick and a stall must show up on time,
    //   3. once a minute regardless, so "3m ago" style text stays honest.
    pollTimer = setInterval(() => {
      const now = Date.now();
      if (now - lastPoll >= settings.refreshInterval) {
        lastPoll = now;
        const m = reader.latestMtime();
        if (m !== lastMtime) { lastMtime = m; lastFullRefresh = now; refresh(); return; }
      }
      const running = data.tasks.some(t => t.status === 'running');
      if (running || now - lastFullRefresh >= 60000) { lastFullRefresh = now; refresh(); }
    }, 1000);
  };
  startPoll();
  context.subscriptions.push({ dispose: () => { if (pollTimer) clearInterval(pollTimer); if (refreshTimer) clearTimeout(refreshTimer); } });

  // ---- settings / workspace changes -------------------------------------------------
  const reconfigure = () => {
    settings = readSettings();
    const dir = resolveLogsDir(settings);
    if (dir !== reader.logsDir) { reader.setLogsDir(dir); startWatchers(); }
    startPoll();
    refresh(true);
  };
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('scriptProgress')) reconfigure(); }),
    vscode.workspace.onDidChangeWorkspaceFolders(reconfigure),
    vscode.workspace.onDidGrantWorkspaceTrust(() => refresh(true)),
  );

  // ---- commands ---------------------------------------------------------------------
  registerCommands(context, {
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
export function resolveLogsDir(settings: Settings): string {
  const p = settings.logsPath;
  if (path.isAbsolute(p)) return path.normalize(p);
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (ws) return path.normalize(path.join(ws, p));
  // No folder open: fall back to the home directory so the extension still activates cleanly.
  return path.normalize(path.join(process.env.USERPROFILE || process.env.HOME || process.cwd(), p));
}

export function deactivate(): void {
  disposeCommands();
}
