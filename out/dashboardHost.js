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
// The one renderer behind both the sidebar view and the editor-tab panel.
// It owns the page shell (CSP, CSS, scripts) and pushes updates by postMessage so the
// page is never reloaded — that is what keeps scroll position and the map's layout intact.
const crypto = __importStar(require("crypto"));
const vscode = __importStar(require("vscode"));
const dashboard_1 = require("./render/dashboard");
const graph_1 = require("./logic/graph");
const time_1 = require("./logic/time");
const actions_1 = require("./actions");
class DashboardHost {
    constructor(extensionUri, surface, state) {
        this.extensionUri = extensionUri;
        this.surface = surface;
        this.state = state;
        this.lastSections = '';
        this.lastGraphKey = '';
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
        const sections = (0, dashboard_1.renderSections)(data, settings, { now, surface: this.surface, trusted: vscode.workspace.isTrusted });
        // The graph only travels to the panel (the sidebar shows a summary rendered in HTML).
        let graph = null;
        let graphKey = '';
        if (settings.sections.accessMap && this.surface === 'panel') {
            graph = (0, graph_1.buildGraph)(data.access, data.progress, settings.accessMapMaxNodes);
            graphKey = JSON.stringify(graph);
        }
        const sectionsChanged = force || sections !== this.lastSections;
        const graphChanged = force || graphKey !== this.lastGraphKey;
        if (!sectionsChanged && !graphChanged)
            return;
        this.lastSections = sections;
        this.lastGraphKey = graphKey;
        void this.webview.postMessage({
            type: 'update',
            sections: sectionsChanged ? sections : undefined,
            graph: graphChanged ? graph : undefined,
            state: (0, time_1.taskState)(data.progress, settings.staleRunningMinutes, now),
            reducedMotion: false,
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
                    await (0, actions_1.runQuickAction)(b);
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
    shell(webview) {
        const nonce = crypto.randomBytes(16).toString('base64');
        const uri = (...p) => webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'media', ...p));
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
    dispose() {
        for (const d of this.disposables)
            d.dispose();
        this.disposables = [];
        this.webview = undefined;
    }
}
exports.DashboardHost = DashboardHost;
//# sourceMappingURL=dashboardHost.js.map