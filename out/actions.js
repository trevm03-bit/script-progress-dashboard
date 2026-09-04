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
exports.commandForFile = exports.ActionRunner = exports.TASK_TYPE = void 0;
exports.expandVariables = expandVariables;
// Quick Actions: turn a button click (or a task, or a context-menu file) into a command, safely.
//   1. refuse in an untrusted workspace,
//   2. ask for every ${prompt:Question} value the command contains; substitute ${file},
//   3. ask for confirmation when the button says so (default yes), showing the final command,
//   4. run it in the reusable "Script Progress" terminal, or as a VS Code task (exit code captured).
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const prompts_1 = require("./logic/prompts");
const TERMINAL_NAME = 'Script Progress';
exports.TASK_TYPE = 'scriptProgress';
/** Substitute ${file} / ${fileBasename} / ${fileDirname} / ${workspaceFolder}. */
function expandVariables(command, extra = {}) {
    const editor = vscode.window.activeTextEditor;
    const file = editor?.document.uri.scheme === 'file' ? editor.document.uri.fsPath : '';
    const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    const vars = {
        file, fileBasename: file ? path.basename(file) : '', fileDirname: file ? path.dirname(file) : '', workspaceFolder: ws, ...extra,
    };
    return command.replace(/\$\{(file|fileBasename|fileDirname|workspaceFolder)\}/g, (_, k) => vars[k] ?? '');
}
class ActionRunner {
    constructor(getSettings, sink) {
        this.getSettings = getSettings;
        this.sink = sink;
        this.disposables = [];
        /** Executions we started, so exit events can be attributed. */
        this.started = new Map();
        // Task exit codes (runVia: task).
        this.disposables.push(vscode.tasks.onDidEndTaskProcess(e => {
            if (e.execution.task.definition.type !== exports.TASK_TYPE)
                return;
            const label = String(e.execution.task.definition.action ?? e.execution.task.name);
            const info = this.started.get(`task:${label}`);
            this.started.delete(`task:${label}`);
            if (typeof e.exitCode === 'number' && e.exitCode !== 0) {
                this.sink.onExit({ task: info?.task ?? label, exitCode: e.exitCode, when: new Date().toISOString() }, label);
            }
        }));
        // Terminal shell-integration exit codes (VS Code 1.93+); feature-detected, harmless on 1.80.
        const w = vscode.window;
        if (typeof w.onDidEndTerminalShellExecution === 'function') {
            this.disposables.push(w.onDidEndTerminalShellExecution(e => {
                if (e.terminal.name !== TERMINAL_NAME)
                    return;
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
    provideTasks() {
        const s = this.getSettings();
        if (!s.quickActions.asTasks)
            return [];
        return s.buttons.filter(b => !(0, prompts_1.promptLabels)(b.command).length).map(b => this.makeTask(b, b.command));
    }
    resolveTask(task) {
        const label = task.definition.action;
        const b = label ? this.getSettings().buttons.find(x => x.label === label) : undefined;
        if (!b || (0, prompts_1.promptLabels)(b.command).length)
            return undefined; // prompts need the button, not the task runner
        const t = this.makeTask(b, b.command, task.definition);
        return t;
    }
    makeTask(b, command, definition) {
        const ws = vscode.workspace.workspaceFolders?.[0];
        const cwd = b.cwd ? (path.isAbsolute(b.cwd) ? b.cwd : path.join(ws?.uri.fsPath ?? '', b.cwd)) : undefined;
        const def = definition ?? { type: exports.TASK_TYPE, action: b.label };
        const task = new vscode.Task(def, ws ?? vscode.TaskScope.Workspace, b.label, 'Script Progress', new vscode.ShellExecution(command, cwd ? { cwd } : undefined));
        task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, panel: vscode.TaskPanelKind.Shared, clear: false };
        task.group = vscode.TaskGroup.Build;
        return task;
    }
    /** Run a configured button. */
    async runButton(button) {
        if (!vscode.workspace.isTrusted) {
            void vscode.window.showWarningMessage('Script Progress: Quick Actions are disabled in an untrusted workspace.');
            return;
        }
        const answers = {};
        for (const label of (0, prompts_1.promptLabels)(button.command)) {
            const value = await vscode.window.showInputBox({
                title: button.label, prompt: label, ignoreFocusOut: true,
                validateInput: v => (v.trim().length === 0 ? 'A value is required' : undefined),
            });
            if (value === undefined)
                return; // escaped
            answers[label] = value.trim();
        }
        const command = expandVariables((0, prompts_1.expandPrompts)(button.command, answers));
        if (button.confirm !== false) {
            const answer = await vscode.window.showWarningMessage(`Run "${button.label}"?`, { modal: true, detail: command }, 'Run');
            if (answer !== 'Run')
                return;
        }
        await this.execute(command, button.label, button);
    }
    /** Run an ad-hoc command (context menu "Run with Script Progress"). */
    async runCommand(command, label) {
        if (!vscode.workspace.isTrusted) {
            void vscode.window.showWarningMessage('Script Progress: running commands is disabled in an untrusted workspace.');
            return;
        }
        await this.execute(command, label, { label, command, confirm: false });
    }
    async execute(command, label, button) {
        const s = this.getSettings();
        if (s.quickActions.runVia === 'task') {
            this.started.set(`task:${label}`, { label, task: button.task, at: new Date().toISOString() });
            await vscode.tasks.executeTask(this.makeTask(button, command));
            return;
        }
        const terminal = vscode.window.terminals.find(t => t.name === TERMINAL_NAME && t.exitStatus === undefined)
            ?? vscode.window.createTerminal({ name: TERMINAL_NAME, cwd: this.cwdFor(button) });
        terminal.show(true);
        if (this.started.size > 50)
            this.started.clear(); // no shell integration → entries would never be consumed
        this.started.set(`term:${command}`, { label, task: button.task, at: new Date().toISOString() });
        const si = terminal.shellIntegration;
        if (si && typeof si.executeCommand === 'function')
            si.executeCommand(command);
        else
            terminal.sendText(command, true);
    }
    cwdFor(b) {
        const ws = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!b.cwd)
            return ws;
        return path.isAbsolute(b.cwd) ? b.cwd : path.join(ws ?? '', b.cwd);
    }
    dispose() {
        for (const d of this.disposables)
            d.dispose();
        this.disposables = [];
    }
}
exports.ActionRunner = ActionRunner;
// Re-exported so callers keep importing it from here; the implementation is pure and lives in
// logic/ where it can be tested without a VS Code host.
var shell_1 = require("./logic/shell");
Object.defineProperty(exports, "commandForFile", { enumerable: true, get: function () { return shell_1.commandForFile; } });
//# sourceMappingURL=actions.js.map