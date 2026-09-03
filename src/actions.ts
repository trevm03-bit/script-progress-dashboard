// Quick Actions: turn a button click into a terminal command, safely.
//   1. refuse in an untrusted workspace,
//   2. ask for every ${prompt:Question} value the command contains,
//   3. ask for confirmation when the button says so (default yes), showing the final command,
//   4. send the text to one reusable terminal named "Script Progress".
import * as vscode from 'vscode';
import { QuickActionConfig } from './types';
import { expandPrompts, promptLabels } from './logic/prompts';

const TERMINAL_NAME = 'Script Progress';

export async function runQuickAction(button: QuickActionConfig): Promise<void> {
  if (!vscode.workspace.isTrusted) {
    vscode.window.showWarningMessage('Script Progress: Quick Actions are disabled in an untrusted workspace.');
    return;
  }

  const answers: Record<string, string> = {};
  for (const label of promptLabels(button.command)) {
    const value = await vscode.window.showInputBox({
      title: button.label,
      prompt: label,
      ignoreFocusOut: true,
      validateInput: v => (v.trim().length === 0 ? 'A value is required' : undefined),
    });
    if (value === undefined) return; // escaped
    answers[label] = value.trim();
  }
  const command = expandPrompts(button.command, answers);

  if (button.confirm !== false) {
    const answer = await vscode.window.showWarningMessage(`Run "${button.label}"?`, { modal: true, detail: command }, 'Run');
    if (answer !== 'Run') return;
  }

  const terminal = vscode.window.terminals.find(t => t.name === TERMINAL_NAME && t.exitStatus === undefined)
    ?? vscode.window.createTerminal(TERMINAL_NAME);
  terminal.show(true);
  terminal.sendText(command, true);
}
