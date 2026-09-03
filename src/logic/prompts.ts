// ${prompt:Question} tokens inside a Quick Action command. Pure so it can be unit-tested.
const PROMPT_TOKEN = /\$\{prompt:([^}]*)\}/g;

/** The prompt labels in a command, in order, de-duplicated. */
export function promptLabels(command: string): string[] {
  const out: string[] = [];
  for (const m of command.matchAll(PROMPT_TOKEN)) {
    const label = m[1].trim() || 'Value';
    if (!out.includes(label)) out.push(label);
  }
  return out;
}

/** Substitute answers into the command. Unanswered tokens become empty strings. */
export function expandPrompts(command: string, answers: Record<string, string>): string {
  return command.replace(PROMPT_TOKEN, (_, label: string) => answers[label.trim() || 'Value'] ?? '');
}
