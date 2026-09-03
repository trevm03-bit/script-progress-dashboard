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
exports.DashboardHost = void 0;
// The one renderer behind the sidebar view, the editor-tab dashboard and the full-size map tab.
// It owns the page shell (CSP, CSS, scripts) and pushes updates by postMessage so the page is
// never reloaded — that is what keeps scroll position, filters and the map's layout intact.
const crypto = __importStar(require("crypto"));
const vscode = __importStar(require("vscode"));
const dashboard_1 = require("./render/dashboard");
const map_1 = require("./render/map");
const graph_1 = require("./logic/graph");
const time_1 = require("./logic/time");
class DashboardHost {
    constructor(extensionUri, surface, state) {
        this.extensionUri = extensionUri;
        this.surface = surface;
        this.state = state;
        this.lastSections = '';
        this.lastGraphKey = '';
        this.lastReplayId = '';
        /** False until the first refresh: whatever is in history at startup is never replayed. */
        this.replayPrimed = false;
        this.visible = true;
        this.disposables = [];
    }
    /** Wire a webview to this host. Called once per WebviewView/WebviewPanel lifetime. */
    attach(webview) {
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
    setVisible(v) {
        this.visible = v;
        if (v)
            this.refresh(true);
    }
    /** Re-render from current state; only posts when something actually changed. */
    refresh(force = false) {
        if (!this.webview || !this.visible)
            return;
        const data = this.state.getData();
        const settings = this.state.getSettings();
        const now = new Date();
        const collapsed = this.state.getCollapsed();
        // Build the graph once per refresh; the renderer's summary line and the canvas both use it.
        let graph = null;
        let graphKey = '';
        const wantGraph = settings.sections.accessMap && (this.surface !== 'sidebar' || settings.accessMap.sidebarPreview);
        if (settings.sections.accessMap) {
            graph = (0, graph_1.buildGraph)(data.access, data.tasks, settings.accessMap.maxNodes, settings.accessMap.timeWindowDays, now);
            if (wantGraph)
                graphKey = JSON.stringify(graph);
        }
        const sections = this.surface === 'map'
            ? ''
            : (0, dashboard_1.renderSections)(data, settings, { now, surface: this.surface, trusted: vscode.workspace.isTrusted, collapsed, graph: graph ?? undefined });
        // Replay: the newest completed run with an access path, once, and never the one already
        // there when the view opened.
        let replay = null;
        if (settings.accessMap.replay && wantGraph) {
            const last = data.history.slice().sort((a, b) => ((0, time_1.parseIso)(b.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.date)?.getTime() ?? 0))[0];
            const id = last ? (last.runId ?? `${last.task}|${last.date}`) : '';
            if (id !== this.lastReplayId) {
                if (this.replayPrimed && last && (last.accessed?.length ?? 0) > 0)
                    replay = { runId: id, task: last.task, accessed: last.accessed ?? [] };
                this.lastReplayId = id;
            }
        }
        this.replayPrimed = true;
        const sectionsChanged = force || sections !== this.lastSections;
        const graphChanged = force || graphKey !== this.lastGraphKey;
        if (!sectionsChanged && !graphChanged && !replay)
            return;
        this.lastSections = sections;
        this.lastGraphKey = graphKey;
        void this.webview.postMessage({
            type: 'update',
            sections: sectionsChanged ? sections : undefined,
            graph: graphChanged ? (wantGraph ? graph : null) : undefined,
            replay,
            collapsed,
            state: (0, time_1.taskState)(data.progress, settings.staleRunningMinutes, now, data.overlays),
            mapOptions: { layout: settings.accessMap.layout, labels: settings.accessMap.labels, timeWindowDays: settings.accessMap.timeWindowDays },
            density: settings.dashboard.density,
            collapsible: settings.dashboard.collapsible,
        });
    }
    async onMessage(msg) {
        switch (msg?.type) {
            case 'ready':
                this.refresh(true);
                break;
            case 'runAction': {
                // Look the button up by index in CURRENT settings; never trust command text from the page.
                const buttons = this.state.getSettings().buttons;
                const b = typeof msg.index === 'number' ? buttons[msg.index] : undefined;
                if (b)
                    await this.state.runner.runButton(b);
                break;
            }
            case 'collapse': {
                const id = msg.id;
                if (!id)
                    break;
                const cur = new Set(this.state.getCollapsed());
                if (msg.collapsed)
                    cur.add(id);
                else
                    cur.delete(id);
                this.state.setCollapsed([...cur]);
                break;
            }
            case 'openFile': {
                if (!msg.path)
                    break;
                await openArtifact(msg.path);
                break;
            }
            case 'setting': {
                // The map toolbar writes the three map settings so the choice persists.
                const allowed = { 'accessMap.layout': ['force', 'radial'], 'accessMap.labels': ['auto', 'all', 'scripts'] };
                if (msg.id && allowed[msg.id] && typeof msg.value === 'string' && allowed[msg.id].includes(msg.value)) {
                    await vscode.workspace.getConfiguration('scriptProgress').update(msg.id, msg.value, vscode.ConfigurationTarget.Global);
                }
                else if (msg.id === 'accessMap.timeWindowDays' && typeof msg.value === 'string' && /^\d+$/.test(msg.value)) {
                    await vscode.workspace.getConfiguration('scriptProgress').update(msg.id, Number(msg.value), vscode.ConfigurationTarget.Global);
                }
                break;
            }
            case 'exportCsv':
                await vscode.commands.executeCommand('scriptProgress.exportHistoryCsv');
                break;
            case 'openPanel':
                await vscode.commands.executeCommand('scriptProgress.openPanel');
                break;
            case 'openMap':
                await vscode.commands.executeCommand('scriptProgress.openMap');
                break;
            case 'openLogs':
                await vscode.commands.executeCommand('scriptProgress.openLogsFolder');
                break;
            case 'refresh':
                await vscode.commands.executeCommand('scriptProgress.refresh');
                break;
            case 'settings':
                await vscode.commands.executeCommand('scriptProgress.openSettings');
                break;
            case 'sections':
                await vscode.commands.executeCommand('scriptProgress.toggleSections');
                break;
            case 'simulate':
                await vscode.commands.executeCommand('scriptProgress.simulateRun');
                break;
            case 'copySummary':
                await vscode.commands.executeCommand('scriptProgress.copyDailySummary');
                break;
        }
    }
    shell(webview) {
        const nonce = crypto.randomBytes(16).toString('base64');
        const uri = (...p) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', ...p));
        // style-src needs 'unsafe-inline' for the progress-bar width and legend swatch colours, which
        // are per-value inline styles; every value is a number or a theme colour, never user text.
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
        const mapShell = this.surface === 'map' ? `<section class="card card-map map-only" data-section="accessMap">${(0, map_1.mapMarkup)(true)}</section>` : '';
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
    dispose() {
        for (const d of this.disposables)
            d.dispose();
        this.disposables = [];
        this.webview = undefined;
    }
}
exports.DashboardHost = DashboardHost;
/**
 * Open a file a script reported with Progress.artifact(). Text opens in the editor; office and
 * PDF documents open in their app after a confirmation. Never executables, and never in an
 * untrusted workspace — the path comes from a data file the workspace controls.
 */
const EXTERNAL_DOCS = new Set(['xlsx', 'xls', 'xlsm', 'docx', 'doc', 'pptx', 'ppt', 'pdf', 'csv']);
const NEVER_OPEN = new Set(['exe', 'msi', 'bat', 'cmd', 'com', 'scr', 'ps1', 'vbs', 'js', 'jar', 'lnk', 'zip', '7z', 'rar']);
async function openArtifact(p) {
    if (!vscode.workspace.isTrusted) {
        void vscode.window.showWarningMessage('Script Progress: opening artifacts is disabled in an untrusted workspace.');
        return;
    }
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const candidates = [p];
    if (ws && !/^[a-zA-Z]:[\\/]|^\//.test(p))
        candidates.unshift(vscode.Uri.joinPath(vscode.Uri.file(ws), p).fsPath);
    for (const c of candidates) {
        try {
            const uri = vscode.Uri.file(c);
            await vscode.workspace.fs.stat(uri);
            const ext = c.toLowerCase().split('.').pop() ?? '';
            if (NEVER_OPEN.has(ext)) {
                await vscode.commands.executeCommand('revealFileInOS', uri); // show it; never run it
                return;
            }
            if (EXTERNAL_DOCS.has(ext) && ext !== 'csv') {
                const ok = await vscode.window.showInformationMessage(`Open ${c} in its application?`, { modal: true }, 'Open');
                if (ok === 'Open')
                    await vscode.env.openExternal(uri);
                return;
            }
            await vscode.window.showTextDocument(uri, { preview: true });
            return;
        }
        catch { /* try next */ }
    }
    void vscode.window.showWarningMessage(`Script Progress: file not found — ${p}`);
}
//# sourceMappingURL=dashboardHost.js.map