// Editor-tab panels: the full dashboard, and the Access Map on its own. One instance of each;
// re-running the command reveals it.
import * as vscode from 'vscode';
import { DashboardHost, StateProvider } from './dashboardHost';
import { Surface } from './types';

export class DashboardPanel {
  private static open = new Map<Surface, DashboardPanel>();

  static get current(): DashboardPanel | undefined { return DashboardPanel.open.get('panel'); }
  static get map(): DashboardPanel | undefined { return DashboardPanel.open.get('map'); }

  static refreshAll(force = false): void {
    for (const p of DashboardPanel.open.values()) p.refresh(force);
  }

  static createOrShow(extensionUri: vscode.Uri, state: StateProvider, surface: 'panel' | 'map'): DashboardPanel {
    const existing = DashboardPanel.open.get(surface);
    if (existing) {
      existing.panel.reveal(undefined, true);
      existing.host.refresh(true);
      return existing;
    }
    const panel = vscode.window.createWebviewPanel(
      surface === 'map' ? 'scriptProgress.map' : 'scriptProgress.panel',
      surface === 'map' ? 'Access Map' : 'Script Progress Dashboard',
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
    const inst = new DashboardPanel(panel, extensionUri, state, surface);
    DashboardPanel.open.set(surface, inst);
    return inst;
  }

  private readonly host: DashboardHost;

  private constructor(private readonly panel: vscode.WebviewPanel, extensionUri: vscode.Uri, state: StateProvider, surface: Surface) {
    this.host = new DashboardHost(extensionUri, surface, state);
    this.host.attach(panel.webview);
    panel.onDidChangeViewState(() => this.host.setVisible(panel.visible));
    panel.onDidDispose(() => {
      this.host.dispose();
      DashboardPanel.open.delete(surface);
    });
  }

  refresh(force = false): void {
    this.host.refresh(force);
  }
}
