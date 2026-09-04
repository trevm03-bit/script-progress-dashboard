// Quick Actions: turn a button click (or a task, or a context-menu file) into a command, safely.
//   1. refuse in an untrusted workspace,
//   2. ask for every ${prompt:Question} value the command contains; substitute ${file},
//   3. ask for confirmation when the button says so (default yes), showing the final command,
//   4. run it in the reusable "Script Progress" terminal, or as a VS Code task (exit code captured).
import * as path from 'path';
import * as vscode from 'vscode';
import { commandForFile } from './logic/shell';
import { QuickActionConfig, RunOverlay, Settings } from './types';
import { expandPrompts, promptLabels } from './logic/prompts';

const TERMINAL_NAME = 'Script Progress';
export const TASK_TYPE = 'scriptProgress';

export interface ExitSink {
  /** Called when a command we started ends with a non-zero code. */
  onExit(overlay: RunOverlay, label: string): void;
}

/** Substitute ${file} / ${fileBasename} / ${fileDirname} / ${workspaceFolder}. */
export function expandVariables(command: string, extra: Record<string, string> = {}): string {
  const editor = vscode.window.activeTextEditor;
  const file = editor?.document.uri.scheme === 'file' ? editor.document.uri.fsPath : '';
  const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
  const vars: Record<string, string> = {
    file, fileBasename: file ? path.basename(file) : '', fileDirname: file ? path.dirname(file) : '', workspaceFolder: ws, ...extra,
  };
  return command.replace(/\$\{(file|fileBasename|fileDirname|workspaceFolder)\}/g, (_, k: string) => vars[k] ?? '');
}

export class ActionRunner implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  /** Executions we started, so exit events can be attributed. */
  private started = new Map<string, { label: string; task?: string; at: string }>();

  constructor(private readonly getSettings: () => Settings, private readonly sink: ExitSink) {
    // Task exit codes (runVia: task).
    this.disposables.push(vscode.tasks.onDidEndTaskProcess(e => {
      if (e.execution.task.definition.type !== TASK_TYPE) return;
      const label = String(e.execution.task.definition.action ?? e.execution.task.name);
      const info = this.started.get(`task:${label}`);
      this.started.delete(`task:${label}`);
      if (typeof e.exitCode === 'number' && e.exitCode !== 0) {
        this.sink.onExit({ task: info?.task ?? label, exitCode: e.exitCode, when: new Date().toISOString() }, label);
      }
    }));
    // Terminal shell-integration exit codes (VS Code 1.93+); feature-detected, harmless on 1.80.
    const w = vscode.window as unknown as { onDidEndTerminalShellExecution?: (l: (e: { terminal: vscode.Terminal; exitCode?: number; execution: { commandLine: { value: string } } }) => void) => vscode.Disposable };
    if (typeof w.onDidEndTerminalShellExecution === 'function') {
      this.disposables.push(w.onDidEndTerminalShellExecution(e => {
        if (e.terminal.name !== TERMINAL_NAME) return;
        const cmd = e.execution?.commandLine?.value ?? '';
        const info = this.started.get(`term:${cmd}`);
        this.started.delete(`term:${cmd}`);
        if (typeof e.exitCode === 'number' && e.exitCode !== 0) {
          this.sink.onExit({ task: info?.task ?? info?.label ?? cmd.slice(0, 40), exitCode: e.exitCode, when: new Date().toISOString() }, info?.label ?? cmd);
        }
      }));
    }
  }

  /** Tasks for `Terminal → Run Task`, one per button. */
  provideTasks(): vscode.Task[] {
    const s = this.getSettings();
    if (!s.quickActions.asTasks) return [];
    return s.buttons.filter(b => !promptLabels(b.command).length).map(b => this.makeTask(b, b.command));
  }

  resolveTask(task: vscode.Task): vscode.Task | undefined {
    const label = task.definition.action as string | undefined;
    const b = label ? this.getSettings().buttons.find(x => x.label === label) : undefined;
    if (!b || promptLabels(b.command).length) return undefined; // prompts need the button, not the task runner
    const t = this.makeTask(b, b.command, task.definition);
    return t;
  }

  private makeTask(b: QuickActionConfig, command: string, definition?: vscode.TaskDefinition): vscode.Task {
    const ws = vscode.workspace.workspaceFolders?.[0];
    const cwd = b.cwd ? (path.isAbsolute(b.cwd) ? b.cwd : path.join(ws?.uri.fsPath ?? '', b.cwd)) : undefined;
    const def = definition ?? { type: TASK_TYPE, action: b.label };
    const task = new vscode.Task(def, ws ?? vscode.TaskScope.Workspace, b.label, 'Script Progress', new vscode.ShellExecution(command, cwd ? { cwd } : undefined));
    task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Shared, clear: false };
    task.group = vscode.TaskGroup.Build;
    return task;
  }

  /** Run a configured button. */
  async runButton(button: QuickActionConfig): Promise<void> {
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage('Script Progress: Quick Actions are disabled in an untrusted workspace.');
      return;
    }
    const answers: Record<string, string> = {};
    for (const label of promptLabels(button.command)) {
      const value = await vscode.window.showInputBox({
        title: button.label, prompt: label, ignoreFocusOut: true,
        validateInput: v => (v.trim().length === 0 ? 'A value is required' : undefined),
      });
      if (value === undefined) return; // escaped
      answers[label] = value.trim();
    }
    const command = expandVariables(expandPrompts(button.command, answers));
    if (button.confirm !== false) {
      const answer = await vscode.window.showWarningMessage(`Run "${button.label}"?`, { modal: true, detail: command }, 'Run');
      if (answer !== 'Run') return;
    }
    await this.execute(command, button.label, button);
  }

  /** Run an ad-hoc command (context menu "Run with Script Progress"). */
  async runCommand(command: string, label: string): Promise<void> {
    if (!vscode.workspace.isTrusted) {
      void vscode.window.showWarningMessage('Script Progress: running commands is disabled in an untrusted workspace.');
      return;
    }
    await this.execute(command, label, { label, command, confirm: false });
  }

  private async execute(command: string, label: string, button: QuickActionConfig): Promise<void> {
    const s = this.getSettings();
    if (s.quickActions.runVia === 'task') {
      this.started.set(`task:${label}`, { label, task: button.task, at: new Date().toISOString() });
      await vscode.tasks.executeTask(this.makeTask(button, command));
      return;
    }
    const terminal = vscode.window.terminals.find(t => t.name === TERMINAL_NAME && t.exitStatus === undefined)
      ?? vscode.window.createTerminal({ name: TERMINAL_NAME, cwd: this.cwdFor(button) });
    terminal.show(true);
    if (this.started.size > 50) this.started.clear(); // no shell integration → entries would never be consumed
    this.started.set(`term:${command}`, { label, task: button.task, at: new Date().toISOString() });
    const si = (terminal as unknown as { shellIntegration?: { executeCommand: (c: string) => unknown } }).shellIntegration;
    if (si && typeof si.executeCommand === 'function') si.executeCommand(command);
    else terminal.sendText(command, true);
  }

  private cwdFor(b: QuickActionConfig): string | undefined {
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!b.cwd) return ws;
    return path.isAbsolute(b.cwd) ? b.cwd : path.join(ws ?? '', b.cwd);
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}

// Re-exported so callers keep importing it from here; the implementation is pure and lives in
// logic/ where it can be tested without a VS Code host.
export { commandForFile } from './logic/shell';
