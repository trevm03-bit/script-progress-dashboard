// Failure patterns. PURE.
//
// A single stack trace tells you what broke. Five of them, one at a time, hide the thing worth
// knowing: that four were the same expired credential. Scripts label their own failures
// (`p.fail(summary, category="auth")`) and this counts them, so a repeated cause reads as a
// pattern instead of as bad luck.
//
// Nothing here interprets the words. A taxonomy of everyone's failure modes is not something a
// dashboard can know, and guessing one would be worse than counting what the author wrote.
import { RunRecord } from '../types';
import { parseIso } from './time';

export interface FailureGroup {
  category: string;
  count: number;
  /** Newest first. */
  runs: RunRecord[];
  lastSeen: string;
  tasks: string[];
}

export interface FailurePattern {
  /** Failures considered, newest first. */
  failures: RunRecord[];
  groups: FailureGroup[];
  /** How many of the recent failures the biggest group accounts for. */
  dominant: { category: string; count: number; of: number } | null;
  uncategorised: number;
}

export const UNCATEGORISED = 'uncategorised';

/**
 * Group the most recent `limit` failures by the category their script gave them.
 * `days` bounds how far back to look; 0 means no limit.
 */
export function failurePatterns(history: RunRecord[], now: Date, days = 30, limit = 20): FailurePattern {
  const cutoff = days > 0 ? now.getTime() - days * 86400000 : -Infinity;
  const failures = history
    .filter(r => !r.success && (parseIso(r.date)?.getTime() ?? 0) >= cutoff)
    .sort((a, b) => (parseIso(b.date)?.getTime() ?? 0) - (parseIso(a.date)?.getTime() ?? 0))
    .slice(0, limit);

  const byCat = new Map<string, RunRecord[]>();
  for (const f of failures) {
    const key = (f.category || '').trim() || UNCATEGORISED;
    const list = byCat.get(key);
    if (list) list.push(f); else byCat.set(key, [f]);
  }

  const groups: FailureGroup[] = Array.from(byCat.entries())
    .map(([category, runs]) => ({
      category,
      count: runs.length,
      runs,
      lastSeen: runs[0]?.date ?? '',
      tasks: Array.from(new Set(runs.map(r => r.task))),
    }))
    // Biggest first, but a tie goes to the one that happened most recently.
    .sort((a, b) => b.count - a.count || (parseIso(b.lastSeen)?.getTime() ?? 0) - (parseIso(a.lastSeen)?.getTime() ?? 0));

  // Only a NAMED category can be a pattern worth reporting, and only when it is more than one
  // of at least two failures: "1 of 1 failures was auth" is noise dressed as insight.
  const top = groups.find(g => g.category !== UNCATEGORISED);
  const dominant = top && top.count >= 2 && failures.length >= 2
    ? { category: top.category, count: top.count, of: failures.length }
    : null;

  return {
    failures,
    groups,
    dominant,
    uncategorised: byCat.get(UNCATEGORISED)?.length ?? 0,
  };
}

/** "3 of the last 5 failures were auth" — or null when there is no pattern to report. */
export function patternText(p: FailurePattern): string | null {
  if (!p.dominant) return null;
  const { category, count, of } = p.dominant;
  return `${count} of the last ${of} failures ${count === 1 ? 'was' : 'were'} ${category}`;
}
