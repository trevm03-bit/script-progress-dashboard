// The one renderer behind the sidebar view, the editor-tab dashboard and the full-size map tab.
// It owns the page shell (CSP, CSS, scripts) and pushes updates by postMessage so the page is
// never reloaded — that is what keeps scroll position, filters and the map's layout intact.
import * as crypto from 'crypto';
import * as path from 'path';
import * as vscode from 'vscode';
import { DashboardData, RunRecord, Settings, Surface, SectionId } from './types';
import { renderSections } from './render/dashboard';
import { mapMarkup } from './render/map';
import { buildGraph, DrawGraph } from './logic/graph';
import { parseIso, taskState, clockTime } from './logic/time';
import { ActionRunner } from './actions';

export interface StateProvider {
  getData(): DashboardData;
  getSettings(): Settings;
  runner: ActionRunner;
  /** Collapsed section ids, remembered across sessions. */
  getCollapsed(): SectionId[];
  setCollapsed(ids: SectionId[]): void;
}

export class DashboardHost {
  private webview: vscode.Webview | undefined;
  private lastSections = '';
  private lastGraphKey = '';
  private lastReplayId = '';
  private replayPrimed = false;
  private visible = true;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly surface: Surface,
    private readonly state: StateProvider,
  ) {}

  attach(webview: vscode.Webview): void {
    this.webview = webview;
    this.lastSections = '';
    this.lastGraphKey = '';
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'media')],
    };
    webview.html = this.shell(webview);
    this.disposables.push(webview.onDidReceiveMessage(msg => this.onMessage(msg)));
  }

  setVisible(v: boolean): void {
    this.visible = v;
    if (v) this.refresh(true);
  }

  /** Re-render from current state; only posts when something actually changed. */
  refresh(force = false): void {
    if (!this.webview || !this.visible) return;
    const data = this.state.getData();
    const settings = this.state.getSettings();
    const now = new Date();
    const collapsed = this.state.getCollapsed();

    let graph: DrawGraph | null = null;
    let graphKey = '';
    const wantGraph = settings.sections.accessMap && (this.surface !== 'sidebar' || settings.accessMap.sidebarPreview);
    if (settings.sections.accessMap) {
      graph = buildGraph(data.access, data.tasks, settings.accessMap.maxNodes, settings.accessMap.timeWindowDays, now);
      if (wantGraph) graphKey = JSON.stringify(graph);
    }

    const sections = this.surface === 'map'
      ? ''
      : renderSections(data, settings, { now, surface: this.surface, trusted: vscode.workspace.isTrusted, collapsed, graph: graph ?? undefined });

    const sortedHistory = data.history.slice().sort((a, b) => (parseIso(b.date)?.getTime() ?? 0) - (parseIso(a.date)?.getTime() ?? 0));
    let replay: { runId: string; task: string; accessed: string[] } | null = null;
    if (settings.accessMap.replay && wantGraph) {
      const last = sortedHistory[0] as RunRecord | undefined;
      const id = last ? (last.runId ?? `${last.task}|${last.date}`) : '';
      if (id !== this.lastReplayId) {
        if (this.replayPrimed && last && (last.accessed?.length ?? 0) > 0) replay = { runId: id, task: last.task, accessed: last.accessed ?? [] };
        this.lastReplayId = id;
      }
    }
    this.replayPrimed = true;
    const recentRuns = wantGraph ? sortedHistory.filter(r => (r.accessed?.length ?? 0) > 0).slice(0, 8).map(r => ({ task: r.task, date: r.date, accessed: r.accessed })) : [];

    const sectionsChanged = force || sections !== this.lastSections;
    const graphChanged = force || graphKey !== this.lastGraphKey;
    if (!sectionsChanged && !graphChanged && !replay) return;
    this.lastSections = sections;
    this.lastGraphKey = graphKey;

    const state = taskState(data.progress, settings.staleRunningMinutes, now, data.overlays);
    const running = data.tasks.filter(t => taskState(t, settings.staleRunningMinutes, now, data.overlays) === 'running').length;
    void this.webview.postMessage({
      type: 'update',
      sections: sectionsChanged ? sections : undefined,
      graph: graphChanged ? (wantGraph ? graph : null) : undefined,
      replay,
      collapsed,
      state,
      status: {
        state,
        running,
        text: running ? `${running} running` : state === 'stalled' ? 'stalled' : state === 'exited' ? 'exited' : state === 'failed' ? 'last run failed' : state === 'complete' ? 'idle · last run ok' : 'idle',
        updated: clockTime(now.toISOString()),
        logsDir: data.logsDir,
      },
      mapOptions: {
        layout: settings.accessMap.layout, labels: settings.accessMap.labels, timeWindowDays: settings.accessMap.timeWindowDays,
        ambient: settings.accessMap.ambient, halos: settings.accessMap.halos, glyphs: settings.accessMap.glyphs, minimap: settings.accessMap.minimap, starfield: settings.accessMap.starfield,
        recentRuns,
      },
      density: settings.dashboard.density,
      collapsible: settings.dashboard.collapsible,
    });
  }

  private async onMessage(msg: { type: string; index?: number; id?: string; collapsed?: boolean; path?: string; label?: string; value?: string; text?: string; data?: string }): Promise<void> {
    switch (msg?.type) {
      case 'ready':
        this.refresh(true);
        break;
      case 'runAction': {
        const buttons = this.state.getSettings().buttons;
        const b = typeof msg.index === 'number' ? buttons[msg.index] : undefined;
        if (b) await this.state.runner.runButton(b);
        break;
      }
      case 'collapse': {
        const id = msg.id as SectionId | undefined;
        if (!id) break;
        const cur = new Set(this.state.getCollapsed());
        if (msg.collapsed) cur.add(id); else cur.delete(id);
        this.state.setCollapsed([...cur]);
        break;
      }
      case 'openFile':
        if (msg.path) await openArtifact(msg.path);
        break;
      case 'setting': {
        const allowed: Record<string, string[]> = { 'accessMap.layout': ['force', 'radial'], 'accessMap.labels': ['auto', 'all', 'scripts'] };
        if (msg.id && allowed[msg.id] && typeof msg.value === 'string' && allowed[msg.id].includes(msg.value)) {
          await vscode.workspace.getConfiguration('scriptProgress').update(msg.id, msg.value, vscode.ConfigurationTarget.Global);
        } else if (msg.id === 'accessMap.timeWindowDays' && typeof msg.value === 'string' && /^\d+$/.test(msg.value)) {
          await vscode.workspace.getConfiguration('scriptProgress').update(msg.id, Number(msg.value), vscode.ConfigurationTarget.Global);
        }
        break;
      }
      case 'copy':
        if (typeof msg.text === 'string' && msg.text.length < 2000) {
          await vscode.env.clipboard.writeText(msg.text);
          vscode.window.setStatusBarMessage(`$(check) Copied "${msg.text.slice(0, 40)}"`, 2000);
        }
        break;
      case 'savePng': {
        const m = typeof msg.data === 'string' ? /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(msg.data) : null;
        if (!m) break;
        const stamp = new Date().toISOString().slice(0, 10);
        const target = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(path.join(this.state.getData().logsDir, `access-map-${stamp}.png`)), filters: { PNG: ['png'] }, title: 'Save the Access Map as PNG' });
        if (!target) break;
        await vscode.workspace.fs.writeFile(target, Buffer.from(m[1], 'base64'));
        const pick = await vscode.window.showInformationMessage(`Saved ${path.basename(target.fsPath)}.`, 'Reveal');
        if (pick) await vscode.commands.executeCommand('revealFileInOS', target);
        break;
      }
      case 'filterHistory':
        // The map tab has no history table: open the dashboard, which carries the filter box.
        if (this.surface === 'map') await vscode.commands.executeCommand('scriptProgress.openPanel');
        break;
      case 'exportCsv': await vscode.commands.executeCommand('scriptProgress.exportHistoryCsv'); break;
      case 'exportReport': await vscode.commands.executeCommand('scriptProgress.exportReport'); break;
      case 'openPanel': await vscode.commands.executeCommand('scriptProgress.openPanel'); break;
      case 'openMap': await vscode.commands.executeCommand('scriptProgress.openMap'); break;
      case 'openLogs': await vscode.commands.executeCommand('scriptProgress.openLogsFolder'); break;
      case 'refresh': await vscode.commands.executeCommand('scriptProgress.refresh'); break;
      case 'settings': await vscode.commands.executeCommand('scriptProgress.openSettings'); break;
      case 'sections': await vscode.commands.executeCommand('scriptProgress.toggleSections'); break;
      case 'simulate': await vscode.commands.executeCommand('scriptProgress.simulateRun'); break;
      case 'copySummary': await vscode.commands.executeCommand('scriptProgress.copyDailySummary'); break;
      case 'walkthrough': await vscode.commands.executeCommand('scriptProgress.openWalkthrough'); break;
    }
  }

  private shell(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    const uri = (...p: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', ...p));
    // style-src needs 'unsafe-inline' for the progress-bar width, legend swatches and timeline bar
    // positions, which are per-value inline styles; every value is a number or a theme colour.
    const csp = [
      `default-src 'none'`,
      `base-uri 'none'`,
      `form-action 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    const s = this.state.getSettings();
    const title = this.surface === 'map' ? 'Access Map' : this.surface === 'panel' ? 'Script Progress Dashboard' : 'Script Progress';
    const tool = (msg: string, ic: string, t: string) => `<button class="icon-btn" data-msg="${msg}" title="${t}"><i class="codicon codicon-${ic}"></i></button>`;
    const tools = this.surface === 'sidebar'
      ? tool('openPanel', 'link-external', 'Open as editor tab') + tool('refresh', 'refresh', 'Refresh now') + tool('sections', 'checklist', 'Choose sections')
      : this.surface === 'panel'
        ? tool('copySummary', 'clippy', 'Copy daily summary') + tool('exportReport', 'file-pdf', 'Export a shareable HTML report') + tool('openMap', 'graph', 'Open the Access Map as its own tab') + tool('refresh', 'refresh', 'Refresh now') + tool('sections', 'checklist', 'Choose sections') + tool('openLogs', 'folder-opened', 'Open logs folder') + tool('settings', 'settings-gear', 'Settings')
        : tool('openPanel', 'dashboard', 'Open the dashboard') + tool('settings', 'settings-gear', 'Settings');
    const mapShell = this.surface === 'map' ? `<section class="card card-map map-only" data-section="accessMap">${mapMarkup(true)}</section>` : '';
    const sectionCss = ['timeline', 'metrics', 'warningTrends'].map(n => `<link rel="stylesheet" href="${uri('sections', `${n}.css`)}">`).join('\n');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${uri('codicons', 'codicon.css')}">
<link rel="stylesheet" href="${uri('dashboard.css')}">
${sectionCss}
<title>${title}</title>
</head>
<body class="surface-${this.surface} density-${s.dashboard.density}">
<header class="dash-head">
  <div class="brand">
    <svg class="brand-mark" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><polyline points="2 12 6 12 9 5 13 19 16 12 22 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <h2>${title}</h2>
    <span class="status-pill" id="status-pill" data-state="idle"><i class="dot"></i><span class="pill-text">…</span></span>
  </div>
  <div class="dash-tools"><span class="updated" id="updated" title="Last refresh"></span>${tools}</div>
</header>
<main id="sections">${mapShell || '<div class="empty">Loading…</div>'}</main>
<script nonce="${nonce}" src="${uri('accessMap.js')}"></script>
<script nonce="${nonce}" src="${uri('dashboard.js')}"></script>
</body>
</html>`;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.webview = undefined;
  }
}

const EXTERNAL_DOCS = new Set(['xlsx', 'xls', 'xlsm', 'docx', 'doc', 'pptx', 'ppt', 'pdf']);
const NEVER_OPEN = new Set(['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'js', 'jar', 'lnk', 'zip', '7z', 'rar']);

/**
 * Open a file a script reported with Progress.artifact(). Text opens in the editor; office and
 * PDF documents open in their app after a confirmation. Never executables, and never in an
 * untrusted workspace — the path comes from a data file the workspace controls.
 */
async function openArtifact(p: string): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    void vscode.window.showWarningMessage('Script Progress: opening artifacts is disabled in an untrusted workspace.');
    return;
  }
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const candidates = [p];
  if (ws && !/^[a-zA-Z]:[\\/]|^\//.test(p)) candidates.unshift(vscode.Uri.joinPath(vscode.Uri.file(ws), p).fsPath);
  for (const c of candidates) {
    try {
      const uri = vscode.Uri.file(c);
      await vscode.workspace.fs.stat(uri);
      const ext = c.toLowerCase().split('.').pop() ?? '';
      if (NEVER_OPEN.has(ext)) { await vscode.commands.executeCommand('revealFileInOS', uri); return; }
      if (EXTERNAL_DOCS.has(ext)) {
        const ok = await vscode.window.showInformationMessage(`Open ${c} in its application?`, { modal: true }, 'Open');
        if (ok === 'Open') await vscode.env.openExternal(uri);
        return;
      }
      await vscode.window.showTextDocument(uri, { preview: true });
      return;
    } catch { /* try next */ }
  }
  void vscode.window.showWarningMessage(`Script Progress: file not found — ${p}`);
}
