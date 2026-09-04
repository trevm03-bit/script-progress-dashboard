// Detects settings written to a scope that will never take effect, and says so once.
//
// The trap, found in a real install and worth stating plainly because nothing about it is
// obvious: when a window is opened from a `.code-workspace` file, a `.vscode/settings.json`
// inside a folder is FOLDER scope. `workspace.getConfiguration('scriptProgress')` with no
// resource argument resolves at workspace scope and never sees folder values. So the settings
// are present, correctly spelled, valid JSON — and completely inert. The section renders its
// empty state, which reads as "you haven't configured this yet" and sends the user off to
// re-do work they already did.
//
// This cannot be fixed by silently preferring the folder value: with several folders open
// there is no single right answer, and guessing would make the effective configuration depend
// on folder order. So the extension says exactly what it found and offers to open the file.
import * as vscode from 'vscode';

/** Settings whose absence is visible as an empty section — the ones worth warning about. */
const WATCHED = [
  'quickActions.buttons',
  'processCalendar.processes',
  'deltaTracker.metrics',
  'logsPath',
] as const;

const DISMISS_KEY = 'scriptProgress.scopeWarningDismissed';

export interface ScopeFinding {
  key: string;
  /** The folder whose settings.json holds the ignored value. */
  folder: vscode.WorkspaceFolder;
}

/**
 * Values set at folder scope that the extension will not read. Empty in the normal single-folder
 * case, because there folder scope and workspace scope are the same file.
 */
export function findIgnoredFolderSettings(): ScopeFinding[] {
  // Only a window opened from a .code-workspace file separates the two scopes.
  if (!vscode.workspace.workspaceFile) return [];
  const folders = vscode.workspace.workspaceFolders ?? [];
  const out: ScopeFinding[] = [];
  for (const folder of folders) {
    const cfg = vscode.workspace.getConfiguration('scriptProgress', folder.uri);
    for (const key of WATCHED) {
      const info = cfg.inspect(key);
      if (!info) continue;
      const folderValue = info.workspaceFolderValue;
      if (folderValue === undefined || isEmpty(folderValue)) continue;
      // If workspace scope already sets it, the folder value is a deliberate override and works.
      if (info.workspaceValue !== undefined) continue;
      out.push({ key, folder });
    }
  }
  return out;
}

/**
 * Warn once per window about settings that will not apply. Dismissible for good, because a user
 * who has decided to live with it should not be told again on every reload.
 */
export async function warnAboutIgnoredSettings(context: vscode.ExtensionContext): Promise<void> {
  if (context.workspaceState.get<boolean>(DISMISS_KEY)) return;
  const findings = findIgnoredFolderSettings();
  if (!findings.length) return;

  const keys = Array.from(new Set(findings.map(f => f.key)));
  const where = findings[0].folder.name;
  const message =
    `Script Progress: ${keys.map(k => `"${k}"`).join(', ')} ${keys.length === 1 ? 'is' : 'are'} set in ` +
    `${where}/.vscode/settings.json, but this window was opened from a workspace file — so folder ` +
    `settings are not read and ${keys.length === 1 ? 'that setting has' : 'those settings have'} no effect. ` +
    `Move ${keys.length === 1 ? 'it' : 'them'} into the workspace file's "settings" block.`;

  const OPEN_WS = 'Open workspace file';
  const OPEN_FOLDER = 'Open folder settings';
  const NEVER = "Don't show again";
  const pick = await vscode.window.showWarningMessage(message, OPEN_WS, OPEN_FOLDER, NEVER);
  if (pick === NEVER) { await context.workspaceState.update(DISMISS_KEY, true); return; }
  if (pick === OPEN_WS && vscode.workspace.workspaceFile) {
    await vscode.window.showTextDocument(vscode.workspace.workspaceFile);
  }
  if (pick === OPEN_FOLDER) {
    const uri = vscode.Uri.joinPath(findings[0].folder.uri, '.vscode', 'settings.json');
    try { await vscode.window.showTextDocument(uri); }
    catch { await vscode.commands.executeCommand('workbench.action.openWorkspaceSettingsFile'); }
  }
}

function isEmpty(v: unknown): boolean {
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'string') return v.trim() === '';
  if (v && typeof v === 'object') return Object.keys(v).length === 0;
  return false;
}
