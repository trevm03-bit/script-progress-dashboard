// The editor-tab panel. One instance at a time; re-running the command reveals it.
import * as vscode from 'vscode';
import { DashboardHost, StateProvider } from './dashboardHost';

export class DashboardPanel {
  static current: DashboardPanel | undefined;

  static createOrShow(extensionUri: vscode.Uri, state: StateProvider): DashboardPanel {
    if (DashboardPanel.current) {
      DashboardPanel.current.panel.reveal(undefined, true);
      DashboardPanel.current.host.refresh(true);
      return DashboardPanel.current;
    }
    const panel = vscode.window.createWebviewPanel(
      'scriptProgress.panel',
      'Script Progress Dashboard',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      {
        enableScripts: true,
        // The Access Map keeps its layout in the page; rebuilding it on every tab switch would
        // make the constellation jump. This is the one place the memory cost is worth it.
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      },
    );
    panel.iconPath = vscode.Uri.joinPath(extensionUri, 'media', 'icon.svg');
    DashboardPanel.current = new DashboardPanel(panel, extensionUri, state);
    return DashboardPanel.current;
  }

  private readonly host: DashboardHost;

  private constructor(private readonly panel: vscode.WebviewPanel, extensionUri: vscode.Uri, state: StateProvider) {
    this.host = new DashboardHost(extensionUri, 'panel', state);
    this.host.attach(panel.webview);
    panel.onDidChangeViewState(() => this.host.setVisible(panel.visible));
    panel.onDidDispose(() => {
      this.host.dispose();
      DashboardPanel.current = undefined;
    });
  }

  refresh(force = false): void {
    this.host.refresh(force);
  }
}
