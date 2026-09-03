// The one renderer behind both the sidebar view and the editor-tab panel.
// It owns the page shell (CSP, CSS, scripts) and pushes updates by postMessage so the
// page is never reloaded — that is what keeps scroll position and the map's layout intact.
import * as crypto from 'crypto';
import * as vscode from 'vscode';
import { DashboardData, Settings, Surface } from './types';
import { renderSections } from './render/dashboard';
import { buildGraph } from './logic/graph';
import { taskState } from './logic/time';
import { runQuickAction } from './actions';

export interface StateProvider {
  getData(): DashboardData;
  getSettings(): Settings;
}

export class DashboardHost {
  private webview: vscode.Webview | undefined;
  private lastSections = '';
  private lastGraphKey = '';
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
    this.disposables.push(
      webview.onDidReceiveMessage(msg => this.onMessage(msg)),
    );
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
    const sections = renderSections(data, settings, { now, surface: this.surface, trusted: vscode.workspace.isTrusted });

    // The graph only travels to the panel (the sidebar shows a summary rendered in HTML).
    let graph = null;
    let graphKey = '';
    if (settings.sections.accessMap && this.surface === 'panel') {
      graph = buildGraph(data.access, data.progress, settings.accessMapMaxNodes);
      graphKey = JSON.stringify(graph);
    }

    const sectionsChanged = force || sections !== this.lastSections;
    const graphChanged = force || graphKey !== this.lastGraphKey;
    if (!sectionsChanged && !graphChanged) return;
    this.lastSections = sections;
    this.lastGraphKey = graphKey;

    void this.webview.postMessage({
      type: 'update',
      sections: sectionsChanged ? sections : undefined,
      graph: graphChanged ? graph : undefined,
      state: taskState(data.progress, settings.staleRunningMinutes, now),
      reducedMotion: false,
    });
  }

  private async onMessage(msg: { type: string; index?: number }): Promise<void> {
    switch (msg?.type) {
      case 'ready':
        this.refresh(true);
        break;
      case 'runAction': {
        // Look the button up by index in CURRENT settings; never trust command text from the page.
        const buttons = this.state.getSettings().buttons;
        const b = typeof msg.index === 'number' ? buttons[msg.index] : undefined;
        if (b) await runQuickAction(b);
        break;
      }
      case 'openPanel':
        await vscode.commands.executeCommand('scriptProgress.openPanel');
        break;
      case 'openLogs':
        await vscode.commands.executeCommand('scriptProgress.openLogsFolder');
        break;
      case 'refresh':
        await vscode.commands.executeCommand('scriptProgress.refresh');
        break;
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
    const scripts = this.surface === 'panel'
      ? `<script nonce="${nonce}" src="${uri('accessMap.js')}"></script>`
      : '';
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${uri('codicons', 'codicon.css')}">
<link rel="stylesheet" href="${uri('dashboard.css')}">
<title>Script Progress Dashboard</title>
</head>
<body class="surface-${this.surface}">
<header class="dash-head">
  <h2>${this.surface === 'panel' ? 'Script Progress Dashboard' : 'Script Progress'}</h2>
  <div class="dash-tools">
    ${this.surface === 'sidebar' ? `<button class="icon-btn" data-open-panel="1" title="Open as editor tab"><i class="codicon codicon-link-external"></i></button>` : ''}
    <button class="icon-btn" data-refresh="1" title="Refresh now"><i class="codicon codicon-refresh"></i></button>
    <button class="icon-btn" data-open-logs="1" title="Open logs folder"><i class="codicon codicon-folder-opened"></i></button>
  </div>
</header>
<main id="sections"><div class="empty">Loading…</div></main>
${scripts}
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
