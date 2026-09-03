"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DashboardViewProvider = void 0;
const dashboardHost_1 = require("./dashboardHost");
const time_1 = require("./logic/time");
class DashboardViewProvider {
    constructor(extensionUri, state) {
        this.extensionUri = extensionUri;
        this.state = state;
    }
    resolveWebviewView(view) {
        this.host?.dispose();
        this.view = view;
        this.host = new dashboardHost_1.DashboardHost(this.extensionUri, 'sidebar', this.state);
        this.host.attach(view.webview);
        view.onDidChangeVisibility(() => this.host?.setVisible(view.visible));
        view.onDidDispose(() => { this.host?.dispose(); this.host = undefined; this.view = undefined; });
        this.updateBadge();
    }
    refresh(force = false) {
        this.host?.refresh(force);
        this.updateBadge();
    }
    updateBadge() {
        const view = this.view;
        if (!view || !('badge' in view))
            return; // badge API is 1.72+; harmless on older hosts
        const s = this.state.getSettings();
        const d = this.state.getData();
        const now = new Date();
        if (s.badge === 'running') {
            const n = d.tasks.filter(t => (0, time_1.taskState)(t, s.staleRunningMinutes, now, d.overlays) === 'running').length;
            view.badge = n ? { value: n, tooltip: `${n} script${n === 1 ? '' : 's'} running` } : undefined;
        }
        else if (s.badge === 'failures') {
            const n = d.history.filter(r => {
                const t = (0, time_1.parseIso)(r.date);
                return !r.success && t && t.getFullYear() === now.getFullYear() && t.getMonth() === now.getMonth() && t.getDate() === now.getDate();
            }).length;
            view.badge = n ? { value: n, tooltip: `${n} failed run${n === 1 ? '' : 's'} today` } : undefined;
        }
        else {
            view.badge = undefined;
        }
    }
}
exports.DashboardViewProvider = DashboardViewProvider;
DashboardViewProvider.viewId = 'scriptProgress.dashboard';
//# sourceMappingURL=dashboardView.js.map