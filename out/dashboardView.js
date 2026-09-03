"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardViewProvider = void 0;
const dashboardHost_1 = require("./dashboardHost");
class DashboardViewProvider {
    constructor(extensionUri, state) {
        this.extensionUri = extensionUri;
        this.state = state;
    }
    resolveWebviewView(view) {
        this.host?.dispose();
        this.host = new dashboardHost_1.DashboardHost(this.extensionUri, 'sidebar', this.state);
        this.host.attach(view.webview);
        view.onDidChangeVisibility(() => this.host?.setVisible(view.visible));
        view.onDidDispose(() => { this.host?.dispose(); this.host = undefined; });
    }
    refresh(force = false) {
        this.host?.refresh(force);
    }
}
exports.DashboardViewProvider = DashboardViewProvider;
DashboardViewProvider.viewId = 'scriptProgress.dashboard';
//# sourceMappingURL=dashboardView.js.map