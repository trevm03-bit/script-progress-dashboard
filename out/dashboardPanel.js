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
exports.DashboardPanel = void 0;
// Editor-tab panels: the full dashboard, and the Access Map on its own. One instance of each;
// re-running the command reveals it.
const vscode = __importStar(require("vscode"));
const dashboardHost_1 = require("./dashboardHost");
class DashboardPanel {
    static get current() { return DashboardPanel.open.get('panel'); }
    static get map() { return DashboardPanel.open.get('map'); }
    static refreshAll(force = false) {
        for (const p of DashboardPanel.open.values())
            p.refresh(force);
    }
    static createOrShow(extensionUri, state, surface) {
        const existing = DashboardPanel.open.get(surface);
        if (existing) {
            existing.panel.reveal(undefined, true);
            existing.host.refresh(true);
            return existing;
        }
        const panel = vscode.window.createWebviewPanel(surface === 'map' ? 'scriptProgress.map' : 'scriptProgress.panel', surface === 'map' ? 'Access Map' : 'Script Progress Dashboard', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
            enableScripts: true,
            // The Access Map keeps its layout in the page; rebuilding it on every tab switch would
            // make the constellation jump. This is the one place the memory cost is worth it.
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
        });
        panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.svg');
        const inst = new DashboardPanel(panel, extensionUri, state, surface);
        DashboardPanel.open.set(surface, inst);
        return inst;
    }
    constructor(panel, extensionUri, state, surface) {
        this.panel = panel;
        this.host = new dashboardHost_1.DashboardHost(extensionUri, surface, state);
        this.host.attach(panel.webview);
        panel.onDidChangeViewState(() => this.host.setVisible(panel.visible));
        panel.onDidDispose(() => {
            this.host.dispose();
            DashboardPanel.open.delete(surface);
        });
    }
    refresh(force = false) {
        this.host.refresh(force);
    }
}
exports.DashboardPanel = DashboardPanel;
DashboardPanel.open = new Map();
//# sourceMappingURL=dashboardPanel.js.map