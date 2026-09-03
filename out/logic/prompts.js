"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.promptLabels = promptLabels;
exports.expandPrompts = expandPrompts;
// ${prompt:Question} tokens inside a Quick Action command. Pure so it can be unit-tested.
const PROMPT_TOKEN = /\$\{prompt:([^}]*)\}/g;
/** The prompt labels in a command, in order, de-duplicated. */
function promptLabels(command) {
    const out = [];
    for (const m of command.matchAll(PROMPT_TOKEN)) {
        const label = m[1].trim() || 'Value';
        if (!out.includes(label))
            out.push(label);
    }
    return out;
}
/** Substitute answers into the command. Unanswered tokens become empty strings. */
function expandPrompts(command, answers) {
    return command.replace(PROMPT_TOKEN, (_, label) => answers[label.trim() || 'Value'] ?? '');
}
//# sourceMappingURL=prompts.js.map