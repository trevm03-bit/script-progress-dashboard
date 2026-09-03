// The sidebar view (Activity Bar → Script Progress). Thin wrapper around DashboardHost.
import * as vscode from 'vscode';
import { DashboardHost, StateProvider } from './dashboardHost';

export class DashboardViewProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'scriptProgress.dashboard';
  private host: DashboardHost | undefined;

  constructor(private readonly extensionUri: vscode.Uri, private readonly state: StateProvider) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.host?.dispose();
    this.host = new DashboardHost(this.extensionUri, 'sidebar', this.state);
    this.host.attach(view.webview);
    view.onDidChangeVisibility(() => this.host?.setVisible(view.visible));
    view.onDidDispose(() => { this.host?.dispose(); this.host = undefined; });
  }

  refresh(force = false): void {
    this.host?.refresh(force);
  }
}
