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
exports.runQuickAction = runQuickAction;
// Quick Actions: turn a button click into a terminal command, safely.
//   1. refuse in an untrusted workspace,
//   2. ask for every ${prompt:Question} value the command contains,
//   3. ask for confirmation when the button says so (default yes), showing the final command,
//   4. send the text to one reusable terminal named "Script Progress".
const vscode = __importStar(require("vscode"));
const prompts_1 = require("./logic/prompts");
const TERMINAL_NAME = 'Script Progress';
async function runQuickAction(button) {
    if (!vscode.workspace.isTrusted) {
        vscode.window.showWarningMessage('Script Progress: Quick Actions are disabled in an untrusted workspace.');
        return;
    }
    const answers = {};
    for (const label of (0, prompts_1.promptLabels)(button.command)) {
        const value = await vscode.window.showInputBox({
            title: button.label,
            prompt: label,
            ignoreFocusOut: true,
            validateInput: v => (v.trim().length === 0 ? 'A value is required' : undefined),
        });
        if (value === undefined)
            return; // escaped
        answers[label] = value.trim();
    }
    const command = (0, prompts_1.expandPrompts)(button.command, answers);
    if (button.confirm !== false) {
        const answer = await vscode.window.showWarningMessage(`Run "${button.label}"?`, { modal: true, detail: command }, 'Run');
        if (answer !== 'Run')
            return;
    }
    const terminal = vscode.window.terminals.find(t => t.name === TERMINAL_NAME && t.exitStatus === undefined)
        ?? vscode.window.createTerminal(TERMINAL_NAME);
    terminal.show(true);
    terminal.sendText(command, true);
}
//# sourceMappingURL=actions.js.map