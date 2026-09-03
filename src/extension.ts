// Entry point. Wires settings, the file reader, the watcher + poll, the status bar,
// the sidebar view, the editor panel and the commands together.
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { DataReader, FILES } from './dataReader';
import { readSettings } from './settings';
import { StatusBarManager } from './statusBar';
import { DashboardViewProvider } from './dashboardView';
import { DashboardPanel } from './dashboardPanel';
import { StateProvider } from './dashboardHost';
import { DashboardData, Settings } from './types';
import { dateTime, formatDuration, parseIso } from './logic/time';

export function activate(context: vscode.ExtensionContext): void {
  let settings = readSettings();
  const reader = new DataReader(resolveLogsDir(settings));
  let data: DashboardData = reader.readAll();

  const state: StateProvider = {
    getData: () => data,
    getSettings: () => settings,
  };

  const statusBar = new StatusBarManager();
  const view = new DashboardViewProvider(context.extensionUri, state);
  context.subscriptions.push(
    statusBar,
    vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewId, view),
  );

  // ---- refresh pipeline -------------------------------------------------------------
  let refreshTimer: NodeJS.Timeout | undefined;
  const refresh = (force = false) => {
    data = reader.readAll();
    statusBar.update(data, settings);
    view.refresh(force);
    DashboardPanel.current?.refresh(force);
  };
  // Many watcher events can land within a few ms of each other (four files, tmp+rename);
  // coalesce them so we read once.
  const scheduleRefresh = () => {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => { refreshTimer = undefined; refresh(); }, 60);
  };

  // ---- file watcher (immediate) + poll (safety net) ---------------------------------
  let watcher: vscode.FileSystemWatcher | undefined;
  const startWatcher = () => {
    watcher?.dispose();
    watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(vscode.Uri.file(reader.logsDir), '*.json'),
    );
    watcher.onDidChange(scheduleRefresh);
    watcher.onDidCreate(scheduleRefresh);
    watcher.onDidDelete(scheduleRefresh);
    context.subscriptions.push(watcher);
  };
  startWatcher();

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
      const running = data.progress?.status === 'running';
      if (running || now - lastFullRefresh >= 60000) { lastFullRefresh = now; refresh(); }
    }, 1000);
  };
  startPoll();
  context.subscriptions.push({ dispose: () => { if (pollTimer) clearInterval(pollTimer); if (refreshTimer) clearTimeout(refreshTimer); } });

  // ---- settings changes -------------------------------------------------------------
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration('scriptProgress')) return;
      settings = readSettings();
      const dir = resolveLogsDir(settings);
      if (dir !== reader.logsDir) {
        reader.setLogsDir(dir);
        startWatcher();
      }
      startPoll();
      refresh(true);
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      settings = readSettings();
      reader.setLogsDir(resolveLogsDir(settings));
      startWatcher();
      refresh(true);
    }),
    vscode.workspace.onDidGrantWorkspaceTrust(() => refresh(true)),
  );

  // ---- commands ---------------------------------------------------------------------
  context.subscriptions.push(
    vscode.commands.registerCommand('scriptProgress.openPanel', () => {
      DashboardPanel.createOrShow(context.extensionUri, state);
    }),
    vscode.commands.registerCommand('scriptProgress.refresh', () => refresh(true)),
    vscode.commands.registerCommand('scriptProgress.openLogsFolder', async () => {
      if (!fs.existsSync(reader.logsDir)) {
        const pick = await vscode.window.showWarningMessage(
          `Logs folder does not exist yet: ${reader.logsDir}`, 'Create it', 'Open Settings');
        if (pick === 'Create it') fs.mkdirSync(reader.logsDir, { recursive: true });
        else if (pick === 'Open Settings') await vscode.commands.executeCommand('workbench.action.openSettings', 'scriptProgress.logsPath');
        else return;
      }
      const target = fs.existsSync(path.join(reader.logsDir, FILES.progress))
        ? vscode.Uri.file(path.join(reader.logsDir, FILES.progress))
        : vscode.Uri.file(reader.logsDir);
      await vscode.commands.executeCommand('revealFileInOS', target);
    }),
    vscode.commands.registerCommand('scriptProgress.showHistory', () => {
      const channel = getHistoryChannel();
      channel.clear();
      const runs = data.history.slice().sort((a, b) => (parseIso(b.date)?.getTime() ?? 0) - (parseIso(a.date)?.getTime() ?? 0));
      channel.appendLine(`Run history — ${runs.length} run(s) from ${path.join(reader.logsDir, FILES.history)}`);
      channel.appendLine('');
      for (const run of runs) {
        const tag = run.success ? 'PASS' : 'FAIL';
        const warn = run.warnings ? ` | ${run.warnings} warning(s)` : '';
        channel.appendLine(`[${tag}] ${dateTime(run.date)} | ${run.task} | ${formatDuration(run.elapsed)}${warn} | ${run.summary ?? ''}`);
      }
      channel.show(true);
    }),
  );

  refresh(true);
}

let historyChannel: vscode.OutputChannel | undefined;
function getHistoryChannel(): vscode.OutputChannel {
  if (!historyChannel) historyChannel = vscode.window.createOutputChannel('Script Progress History');
  return historyChannel;
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
  historyChannel?.dispose();
  historyChannel = undefined;
}
