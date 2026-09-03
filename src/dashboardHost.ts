// The one renderer behind the sidebar view, the editor-tab dashboard and the full-size map tab.
// It owns the page shell (CSP, CSS, scripts) and pushes updates by postMessage so the page is
// never reloaded — that is what keeps scroll position, filters and the map's layout intact.
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { DashboardData, RunRecord, Settings, Surface, SectionId } from './types';
import { renderSections } from './render/dashboard';
import { buildGraph } from './logic/graph';
import { parseIso, taskState } from './logic/time';
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
  private visible = true;
  private disposables: vscode.Disposable[] = [];

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly surface: Surface,
    private readonly state: StateProvider,
  ) {}

  /** Wire a webview to this host. Called once per WebviewView/WebviewPanel lifetime. */
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
    const sections = this.surface === 'map'
      ? ''
      : renderSections(data, settings, { now, surface: this.surface, trusted: vscode.workspace.isTrusted, collapsed });

    // The graph travels to the panel and the map tab, and to the sidebar when the preview is on.
    let graph = null;
    let graphKey = '';
    const wantGraph = settings.sections.accessMap && (this.surface !== 'sidebar' || settings.accessMap.sidebarPreview);
    if (wantGraph) {
      graph = buildGraph(data.access, data.tasks, settings.accessMap.maxNodes, settings.accessMap.timeWindowDays, now);
      graphKey = JSON.stringify(graph);
    }

    // Replay: the newest completed run with an access path, once.
    let replay: { runId: string; task: string; accessed: string[] } | null = null;
    if (settings.accessMap.replay && wantGraph) {
      const last = data.history.slice().sort((a, b) => (parseIso(b.date)?.getTime() ?? 0) - (parseIso(a.date)?.getTime() ?? 0))[0] as RunRecord | undefined;
      const id = last ? (last.runId ?? `${last.task}|${last.date}`) : '';
      if (last && id && id !== this.lastReplayId && (last.accessed?.length ?? 0) > 0) {
        // Only replay runs that finished while we were watching (not the one already there at startup).
        if (this.lastReplayId !== '') replay = { runId: id, task: last.task, accessed: last.accessed ?? [] };
        this.lastReplayId = id;
      }
    }

    const sectionsChanged = force || sections !== this.lastSections;
    const graphChanged = force || graphKey !== this.lastGraphKey;
    if (!sectionsChanged && !graphChanged && !replay) return;
    this.lastSections = sections;
    this.lastGraphKey = graphKey;

    void this.webview.postMessage({
      type: 'update',
      sections: sectionsChanged ? sections : undefined,
      graph: graphChanged ? graph : undefined,
      replay,
      collapsed,
      state: taskState(data.progress, settings.staleRunningMinutes, now, data.overlays),
      mapOptions: { layout: settings.accessMap.layout, labels: settings.accessMap.labels, timeWindowDays: settings.accessMap.timeWindowDays },
      density: settings.dashboard.density,
      collapsible: settings.dashboard.collapsible,
    });
  }

  private async onMessage(msg: { type: string; index?: number; id?: string; collapsed?: boolean; path?: string; label?: string; value?: string }): Promise<void> {
    switch (msg?.type) {
      case 'ready':
        this.refresh(true);
        break;
      case 'runAction': {
        // Look the button up by index in CURRENT settings; never trust command text from the page.
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
      case 'openFile': {
        if (!msg.path) break;
        await openArtifact(msg.path);
        break;
      }
      case 'setting': {
        // The map toolbar writes the three map settings so the choice persists.
        const allowed: Record<string, string[]> = { 'accessMap.layout': ['force', 'radial'], 'accessMap.labels': ['auto', 'all', 'scripts'] };
        if (msg.id && allowed[msg.id] && typeof msg.value === 'string' && allowed[msg.id].includes(msg.value)) {
          await vscode.workspace.getConfiguration('scriptProgress').update(msg.id, msg.value, vscode.ConfigurationTarget.Global);
        } else if (msg.id === 'accessMap.timeWindowDays' && typeof msg.value === 'string' && /^\d+$/.test(msg.value)) {
          await vscode.workspace.getConfiguration('scriptProgress').update(msg.id, Number(msg.value), vscode.ConfigurationTarget.Global);
        }
        break;
      }
      case 'openPanel': await vscode.commands.executeCommand('scriptProgress.openPanel'); break;
      case 'openMap': await vscode.commands.executeCommand('scriptProgress.openMap'); break;
      case 'openLogs': await vscode.commands.executeCommand('scriptProgress.openLogsFolder'); break;
      case 'refresh': await vscode.commands.executeCommand('scriptProgress.refresh'); break;
      case 'settings': await vscode.commands.executeCommand('scriptProgress.openSettings'); break;
      case 'sections': await vscode.commands.executeCommand('scriptProgress.toggleSections'); break;
      case 'simulate': await vscode.commands.executeCommand('scriptProgress.simulateRun'); break;
      case 'copySummary': await vscode.commands.executeCommand('scriptProgress.copyDailySummary'); break;
    }
  }

  private shell(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    const uri = (...p: string[]) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', ...p));
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    const s = this.state.getSettings();
    const title = this.surface === 'map' ? 'Access Map' : this.surface === 'panel' ? 'Script Progress Dashboard' : 'Script Progress';
    const tools = this.surface === 'sidebar'
      ? `<button class="icon-btn" data-msg="openPanel" title="Open as editor tab"><i class="codicon codicon-link-external"></i></button>
         <button class="icon-btn" data-msg="refresh" title="Refresh now"><i class="codicon codicon-refresh"></i></button>
         <button class="icon-btn" data-msg="sections" title="Choose sections"><i class="codicon codicon-checklist"></i></button>`
      : this.surface === 'panel'
        ? `<button class="icon-btn" data-msg="copySummary" title="Copy daily summary"><i class="codicon codicon-clippy"></i></button>
           <button class="icon-btn" data-msg="openMap" title="Open the Access Map as its own tab"><i class="codicon codicon-graph"></i></button>
           <button class="icon-btn" data-msg="refresh" title="Refresh now"><i class="codicon codicon-refresh"></i></button>
           <button class="icon-btn" data-msg="sections" title="Choose sections"><i class="codicon codicon-checklist"></i></button>
           <button class="icon-btn" data-msg="openLogs" title="Open logs folder"><i class="codicon codicon-folder-opened"></i></button>
           <button class="icon-btn" data-msg="settings" title="Settings"><i class="codicon codicon-settings-gear"></i></button>`
        : `<button class="icon-btn" data-msg="openPanel" title="Open the dashboard"><i class="codicon codicon-dashboard"></i></button>
           <button class="icon-btn" data-msg="settings" title="Settings"><i class="codicon codicon-settings-gear"></i></button>`;
    const mapShell = this.surface === 'map' ? `<section class="card card-map map-only" data-section="accessMap">${mapMarkup(true)}</section>` : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${uri('codicons', 'codicon.css')}">
<link rel="stylesheet" href="${uri('dashboard.css')}">
<title>${title}</title>
</head>
<body class="surface-${this.surface} density-${s.dashboard.density}">
<header class="dash-head">
  <h2>${title}</h2>
  <div class="dash-tools">${tools}</div>
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

/** The map's DOM (toolbar, canvas, detail card). Shared by the panel section and the map tab. */
export function mapMarkup(large: boolean): string {
  return `
<div class="map-toolbar">
  <input type="search" class="map-search" placeholder="Search nodes…" aria-label="Search nodes" spellcheck="false">
  <select class="map-layout" title="Layout"><option value="force">Force</option><option value="radial">Radial</option></select>
  <select class="map-window" title="Time window"><option value="0">All time</option><option value="1">24 hours</option><option value="7">7 days</option><option value="30">30 days</option></select>
  <select class="map-labels" title="Labels"><option value="auto">Labels: auto</option><option value="all">Labels: all</option><option value="scripts">Labels: scripts</option></select>
  <button class="icon-btn map-fit" title="Fit to view"><i class="codicon codicon-screen-full"></i></button>
  <button class="icon-btn map-reset" title="Re-run the layout"><i class="codicon codicon-debug-restart"></i></button>
  ${large ? '' : '<button class="icon-btn" data-msg="openMap" title="Open as its own tab"><i class="codicon codicon-link-external"></i></button>'}
</div>
<div class="map-legend"></div>
<div class="map-host ${large ? 'map-host-large' : ''}">
  <canvas class="map-canvas" aria-label="Access map"></canvas>
  <div class="map-tip" hidden></div>
  <aside class="map-detail" hidden></aside>
  <div class="map-hint">drag to pan · wheel to zoom · drag a node · click for detail · double-click to reset</div>
</div>`;
}

async function openArtifact(p: string): Promise<void> {
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const candidates = [p];
  if (ws && !/^[a-zA-Z]:[\\/]|^\//.test(p)) candidates.unshift(vscode.Uri.joinPath(vscode.Uri.file(ws), p).fsPath);
  for (const c of candidates) {
    try {
      const uri = vscode.Uri.file(c);
      await vscode.workspace.fs.stat(uri);
      const ext = c.toLowerCase().split('.').pop() ?? '';
      if (['xlsx', 'xls', 'docx', 'pptx', 'pdf', 'zip', 'exe'].includes(ext)) await vscode.env.openExternal(uri);
      else await vscode.window.showTextDocument(uri, { preview: true });
      return;
    } catch { /* try next */ }
  }
  void vscode.window.showWarningMessage(`Script Progress: file not found — ${p}`);
}
