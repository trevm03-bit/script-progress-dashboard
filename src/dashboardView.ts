// The sidebar view (Activity Bar → Script Progress). Thin wrapper around DashboardHost, plus
// the badge on the Activity Bar icon.
import * as vscode from 'vscode';
import { DashboardHost, StateProvider } from './dashboardHost';
import { taskState, parseIso } from './logic/time';

export class DashboardViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'scriptProgress.dashboard';
  private host: DashboardHost | undefined;
  private view: vscode.WebviewView | undefined;

  constructor(private readonly extensionUri: vscode.Uri, private readonly state: StateProvider) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.host?.dispose();
    this.view = view;
    this.host = new DashboardHost(this.extensionUri, 'sidebar', this.state);
    this.host.attach(view.webview);
    view.onDidChangeVisibility(() => this.host?.setVisible(view.visible));
    view.onDidDispose(() => { this.host?.dispose(); this.host = undefined; this.view = undefined; });
    this.updateBadge();
  }

  refresh(force = false): void {
    this.host?.refresh(force);
    this.updateBadge();
  }

  private updateBadge(): void {
    const view = this.view as (vscode.WebviewView & { badge?: { value: number; tooltip: string } | undefined }) | undefined;
    if (!view || !('badge' in view)) return; // badge API is 1.72+; harmless on older hosts
    const s = this.state.getSettings();
    const d = this.state.getData();
    const now = new Date();
    if (s.badge === 'running') {
      const n = d.tasks.filter(t => taskState(t, s.staleRunningMinutes, now, d.overlays) === 'running').length;
      view.badge = n ? { value: n, tooltip: `${n} script${n === 1 ? '' : 's'} running` } : undefined;
    } else if (s.badge === 'failures') {
      const n = d.history.filter(r => {
        const t = parseIso(r.date);
        return !r.success && t && t.getFullYear() === now.getFullYear() && t.getMonth() === now.getMonth() && t.getDate() === now.getDate();
      }).length;
      view.badge = n ? { value: n, tooltip: `${n} failed run${n === 1 ? '' : 's'} today` } : undefined;
    } else {
      view.badge = undefined;
    }
  }
}
