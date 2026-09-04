// Generates a runbook from what the extension already knows. PURE.
//
// It knows the processes and their phases (settings), what each script reads and writes (the
// access graph), how long they usually take and what they produce (run history). That is most of
// a runbook, and it is documentation that maintains itself.
//
// 🔴 What it CANNOT know is the human steps — "send the output to someone and wait for it to come
// back" — and that is exactly the gap that matters, because a runbook is read by whoever is
// covering in an emergency. So this marks its own blind spots rather than presenting a tidy list
// that silently omits them. A confident document with a missing step is worse than no document.
import { AccessGraph, DashboardData, ProcessConfig, RunRecord, Settings } from '../types';
import { matchesProcess, runsFor } from './calendar';
import { complianceReport } from './compliance';
import { dateTime, formatDuration, parseIso } from './time';

interface StepFacts {
  name: string;
  runs: RunRecord[];
  /** How many SUCCESSFUL runs the median was taken from — not the same as runs.length. */
  successes: number;
  typical: number | null;
  reads: string[];
  writes: string[];
  artifacts: string[];
}

export function runbookMarkdown(data: DashboardData, settings: Settings, now: Date): string {
  const L: string[] = [];
  L.push('# Runbook');
  L.push('');
  // Local time. toISOString() is UTC, so a runbook generated at 09:00 in UTC-4 was stamped
  // 13:00 with no marker, in a product whose every other date is local (calendar.ts says so).
  L.push(`_Generated ${dateTime(now.toISOString())} by Script Progress Dashboard, from what it has observed._`);
  L.push('');
  L.push('> ## ⚠️ DRAFT — generated, not reviewed');
  L.push('>');
  L.push('> Every ⚠️ below is a place this tool knows it cannot see. Fill them in, then delete');
  L.push('> this banner. Until it is gone, nobody should assume this document is complete.');
  L.push('');
  L.push('> **Read this before relying on it.** Everything below is derived from runs this tool');
  L.push('> has actually seen. It cannot see steps performed by a person, steps that have never');
  L.push('> run while it was watching, or anything done outside these scripts. Sections marked');
  L.push('> ⚠️ are gaps it knows about; there may be others it does not.');
  L.push('');

  if (!settings.processes.length) {
    L.push('No processes are configured, so there is nothing to describe.');
    L.push('Add `scriptProgress.processCalendar.processes` and run this again.');
    return L.join('\n') + '\n';
  }

  for (const p of settings.processes) {
    L.push(`## ${p.label || p.name}`);
    L.push('');
    L.push(`- **Runs:** ${cadence(p)}`);
    if (p.dependsOn?.length) L.push(`- **Cannot start until:** ${p.dependsOn.join(', ')} has run this period`);
    if (p.maxMinutes) L.push(`- **Expected to finish within:** ${p.maxMinutes} minutes`);
    const comp = complianceReport(p, data.history, now, 12);
    if (comp.percent !== null) L.push(`- **Recent reliability:** ran in ${comp.met} of the last ${comp.of} period(s) (${comp.percent}%)`);
    L.push('');

    const stepNames = p.subtasks?.length ? p.subtasks : [p.name];
    L.push(gap('Before step 1'));
    stepNames.forEach((name, i) => {
      const f = facts(name, data, now);
      L.push(`### Step ${i + 1} — ${name}`);
      L.push('');
      if (!f.runs.length) {
        L.push('⚠️ **This tool has never seen this step run**, so it can say nothing about what it');
        L.push('does. Describe it here by hand, or wire it up with the reporter so the next');
        L.push('generation fills it in.');
        L.push('');
        return;
      }
      const cmd = commandFor(name, settings);
      if (cmd) { L.push('```'); L.push(cmd); L.push('```'); L.push(''); }
      else L.push(`⚠️ No Quick Action is configured for this step, so the exact command is unknown.\n`);

      if (f.typical !== null) L.push(`- Usually takes **${formatDuration(f.typical)}** (median of ${f.successes} successful run(s))`);
      if (f.reads.length) L.push(`- Reads: ${f.reads.map(code).join(', ')}`);
      if (f.writes.length) L.push(`- **Writes: ${f.writes.map(code).join(', ')}**`);
      if (!f.reads.length && !f.writes.length) L.push('- ⚠️ No inputs or outputs recorded. Add `p.access(...)` calls so this step can describe itself.');
      if (f.artifacts.length) L.push(`- Produces: ${f.artifacts.map(code).join(', ')}`);
      const last = f.runs[0];
      if (last?.summary) L.push(`- Last run said: _${last.summary}_`);
      L.push('');

      // A gap marker after EVERY step, including the last, and one before the first. The human
      // step is very often the last one — send the file, wait for sign-off — and a marker that
      // only appears between declared phases means a single-step process (the common case)
      // generated a clean, confident document with no warnings at all.
      L.push(gap(`After step ${i + 1}`));
    });
  }

  // A phased process is observed when any PHASE has run: its own name may never appear in
  // history at all. Claiming "never seen" about a process that ran this morning is exactly the
  // wrong thing to tell someone covering in an emergency.
  const unwired = settings.processes.filter(p =>
    !runsFor(p, data.history).length && !(p.subtasks ?? []).some(n => facts(n, data, now).runs.length));
  if (unwired.length) {
    L.push('## ⚠️ Not yet observed');
    L.push('');
    L.push('These processes are configured but this tool has never seen them run, so nothing above');
    L.push('describes them: ' + unwired.map(p => p.label || p.name).join(', ') + '.');
    L.push('');
  }
  return L.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/** The blind spot marker. Deliberately identical wording each time so it is unmissable. */
function gap(where: string): string {
  return `⚠️ **${where}:** if a person does anything here — sends a file, waits for a reply, ` +
    `approves something — write it down. This tool sees only the scripts, so it cannot know.
`;
}

function cadence(p: ProcessConfig): string {
  switch (p.frequency) {
    case 'daily': return `daily${p.dueHour !== undefined ? `, expected by ${String(p.dueHour).padStart(2, '0')}:00` : ''}`;
    case 'weekly': return `weekly${p.dayOfWeek ? `, by day ${p.dayOfWeek} of the week` : ''}`;
    default: return `monthly${p.dayOfMonth ? `, by day ${p.dayOfMonth}` : ''}`;
  }
}

/**
 * Only an EXACT task match. The prefix fallback that used to be here printed the phase-1 command
 * under a phase-3 heading, in a fenced block, with no caveat — in the document someone follows
 * during an incident. No command is safer than the wrong one.
 */
function commandFor(task: string, settings: Settings): string | null {
  const b = settings.buttons.find(x => (x.task || '').toLowerCase() === task.toLowerCase());
  return b?.command ?? null;
}

/**
 * Prefix matching is right for the calendar (a process groups its phases) but wrong here: step
 * "Load" would absorb the runs, durations and WRITE edges of "Load Archive" and then tell an
 * emergency reader this step writes a table it never touches. Require the whole name, or a name
 * followed by a separator.
 */
function stepMatches(task: string, name: string): boolean {
  const t = (task || '').toLowerCase(), n = name.toLowerCase();
  if (t === n) return true;
  return t.startsWith(n) && /[\s:_\-/(]/.test(t.charAt(n.length));
}

function facts(name: string, data: DashboardData, now: Date): StepFacts {
  const runs = data.history
    .filter(r => stepMatches(r.task, name))
    .sort((a, b) => (parseIso(b.date)?.getTime() ?? 0) - (parseIso(a.date)?.getTime() ?? 0));
  const durations = runs.filter(r => r.success).map(r => Number(r.elapsed) || 0).filter(n => n > 0);
  const { reads, writes } = accessFor(name, data.access);
  return {
    name, runs,
    successes: durations.length,
    typical: durations.length ? median(durations) : null,
    reads, writes,
    artifacts: Array.from(new Set(runs.flatMap(r => r.artifacts ?? []))).slice(0, 8),
  };
}

function accessFor(name: string, graph: AccessGraph | null): { reads: string[]; writes: string[] } {
  const reads: string[] = [], writes: string[] = [];
  // access.json is only validated as far as `nodes` being an array, so edges may be anything.
  if (!graph || !Array.isArray(graph.edges) || !Array.isArray(graph.nodes)) return { reads, writes };
  const label = (id: string) => graph.nodes.find(n => n.id === id)?.label ?? id.replace(/^[a-z]+:/, '');
  for (const e of graph.edges) {
    if (!e || typeof e.from !== 'string' || typeof e.to !== 'string') continue;
    const from = e.from.replace(/^task:/, '');
    if (!stepMatches(from, name)) continue;
    (e.mode === 'write' ? writes : reads).push(label(e.to));
  }
  return { reads: unique(reads), writes: unique(writes) };
}

const unique = (a: string[]) => Array.from(new Set(a)).sort();
const code = (s: string) => '`' + s + '`';

function median(values: number[]): number {
  const v = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}
