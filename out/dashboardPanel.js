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
// The editor-tab panel. One instance at a time; re-running the command reveals it.
const vscode = __importStar(require("vscode"));
const dashboardHost_1 = require("./dashboardHost");
class DashboardPanel {
    static createOrShow(extensionUri, state) {
        if (DashboardPanel.current) {
            DashboardPanel.current.panel.reveal(undefined, true);
            DashboardPanel.current.host.refresh(true);
            return DashboardPanel.current;
        }
        const panel = vscode.window.createWebviewPanel('scriptProgress.panel', 'Script Progress Dashboard', { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true }, {
            enableScripts: true,
            // The Access Map keeps its layout in the page; rebuilding it on every tab switch would
            // make the constellation jump. This is the one place the memory cost is worth it.
            retainContextWhenHidden: true,
            localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
        });
        panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.svg');
        DashboardPanel.current = new DashboardPanel(panel, extensionUri, state);
        return DashboardPanel.current;
    }
    constructor(panel, extensionUri, state) {
        this.panel = panel;
        this.host = new dashboardHost_1.DashboardHost(extensionUri, 'panel', state);
        this.host.attach(panel.webview);
        panel.onDidChangeViewState(() => this.host.setVisible(panel.visible));
        panel.onDidDispose(() => {
            this.host.dispose();
            DashboardPanel.current = undefined;
        });
    }
    refresh(force = false) {
        this.host.refresh(force);
    }
}
exports.DashboardPanel = DashboardPanel;
//# sourceMappingURL=dashboardPanel.js.map