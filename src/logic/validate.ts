// Settings validation. PURE: no vscode import, so it is unit-testable.
//
// Why this exists: every one of these mistakes used to fail SILENTLY. A button missing its
// `command` was quietly dropped from the array and the section rendered "No buttons configured
// yet" — which reads as "you haven't set this up" rather than "your third button is malformed".
// A field report lost real time to exactly that class of quiet failure, so the rule here is:
// never discard a user's configuration without saying so, in the section they were looking at.

export type ProblemArea = 'quickActions' | 'processCalendar' | 'deltaTracker' | 'logsPath';

export interface Problem {
  area: ProblemArea;
  /** Which entry, 1-based, for arrays. Undefined for whole-setting problems. */
  index?: number;
  /** What the user called it, if we can tell. */
  label?: string;
  message: string;
}

const FREQUENCIES = ['monthly', 'weekly', 'daily'];

/**
 * Check the raw (unfiltered) values straight from configuration. Returns one problem per thing
 * that will not behave as written. Never throws: bad input is what it is here to describe.
 */
export function validateSettings(raw: {
  buttons?: unknown;
  processes?: unknown;
  deltaMetrics?: unknown;
  deltaThresholds?: unknown;
}): Problem[] {
  const out: Problem[] = [];

  out.push(...validateArray(raw.buttons, 'quickActions', 'quickActions.buttons', (b, add) => {
    const label = str(b.label);
    if (!label) add('needs a "label" — it is the text on the button.');
    if (!str(b.command)) add(`needs a "command" — the shell command to run.`, label);
    if (b.confirm !== undefined && typeof b.confirm !== 'boolean') add('"confirm" must be true or false.', label);
    if (b.icon !== undefined && !str(b.icon)) add('"icon" must be a codicon name, e.g. "play".', label);
    return label;
  }));

  out.push(...validateArray(raw.processes, 'processCalendar', 'processCalendar.processes', (p, add) => {
    const label = str(p.label) || str(p.name);
    if (!str(p.name)) add('needs a "name" — it is matched against the task name your script reports.');
    const freq = str(p.frequency);
    if (!freq) add('needs a "frequency" of "monthly", "weekly" or "daily".', label);
    else if (!FREQUENCIES.includes(freq)) add(`has frequency "${freq}"; expected "monthly", "weekly" or "daily".`, label);
    if (freq === 'monthly') {
      if (p.dayOfMonth === undefined) add('is monthly but has no "dayOfMonth", so it can never be overdue.', label);
      else if (!isInt(p.dayOfMonth, 1, 31)) add(`has dayOfMonth ${fmt(p.dayOfMonth)}; expected a whole number from 1 to 31.`, label);
    }
    if (freq === 'weekly' && p.dayOfWeek !== undefined && !isInt(p.dayOfWeek, 0, 6)) {
      add(`has dayOfWeek ${fmt(p.dayOfWeek)}; expected 0 (Sunday) to 6 (Saturday).`, label);
    }
    if (p.dueHour !== undefined && !isInt(p.dueHour, 0, 23)) add(`has dueHour ${fmt(p.dueHour)}; expected 0 to 23.`, label);
    if (p.maxMinutes !== undefined && !(typeof p.maxMinutes === 'number' && p.maxMinutes > 0)) {
      add(`has maxMinutes ${fmt(p.maxMinutes)}; expected a positive number of minutes.`, label);
    }
    return label;
  }));

  // A threshold for a metric that is not tracked is a no-op the user almost certainly did not intend.
  const tracked = Array.isArray(raw.deltaMetrics) ? raw.deltaMetrics.filter(m => typeof m === 'string') : [];
  const thresholds = isObject(raw.deltaThresholds) ? Object.keys(raw.deltaThresholds) : [];
  for (const key of thresholds) {
    if (!tracked.includes(key)) {
      out.push({ area: 'deltaTracker', label: key, message: `has a threshold but is not in "deltaTracker.metrics", so it is never charted or checked.` });
    }
  }
  for (const key of thresholds) {
    const t = (raw.deltaThresholds as Record<string, unknown>)[key];
    if (!isObject(t)) { out.push({ area: 'deltaTracker', label: key, message: 'threshold must be an object like { "min": -5, "max": 5 }.' }); continue; }
    const min = (t as { min?: unknown }).min, max = (t as { max?: unknown }).max;
    if (min !== undefined && typeof min !== 'number') out.push({ area: 'deltaTracker', label: key, message: '"min" must be a number.' });
    if (max !== undefined && typeof max !== 'number') out.push({ area: 'deltaTracker', label: key, message: '"max" must be a number.' });
    if (typeof min === 'number' && typeof max === 'number' && min > max) {
      out.push({ area: 'deltaTracker', label: key, message: `has min ${min} above max ${max}, so every value is out of range.` });
    }
  }
  return out;
}

/**
 * Problems for one area, in the order the user wrote the entries. Tolerates a missing list so a
 * settings object built elsewhere (tests, an older shape) renders instead of throwing — a
 * renderer must never be the thing that breaks the dashboard.
 */
export function problemsFor(problems: Problem[] | undefined, area: ProblemArea): Problem[] {
  return (problems ?? []).filter(p => p.area === area);
}

/** One line per problem, ready to render or log. */
export function problemText(p: Problem): string {
  const who = p.index !== undefined ? `Entry ${p.index}${p.label ? ` ("${p.label}")` : ''}` : p.label ? `"${p.label}"` : 'This setting';
  return `${who} ${p.message}`;
}

function validateArray(
  value: unknown,
  area: ProblemArea,
  key: string,
  check: (entry: Record<string, unknown>, add: (message: string, label?: string) => void) => string,
): Problem[] {
  const out: Problem[] = [];
  if (value === undefined || value === null) return out;
  if (!Array.isArray(value)) {
    out.push({ area, message: `"${key}" must be a list, e.g. [ { … } ]. It is currently ${describe(value)}.` });
    return out;
  }
  value.forEach((entry, i) => {
    if (!isObject(entry)) {
      out.push({ area, index: i + 1, message: `must be an object, e.g. { … }. It is currently ${describe(entry)}.` });
      return;
    }
    const before = out.length;
    let label = '';
    label = check(entry as Record<string, unknown>, (message, l) => {
      out.push({ area, index: i + 1, label: l ?? label, message });
    });
    // Backfill the label onto problems raised before it was known.
    for (let j = before; j < out.length; j++) if (!out[j].label && label) out[j].label = label;
  });
  return out;
}

function str(v: unknown): string { return typeof v === 'string' ? v.trim() : ''; }
function isObject(v: unknown): v is Record<string, unknown> { return typeof v === 'object' && v !== null && !Array.isArray(v); }
function isInt(v: unknown, min: number, max: number): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
}
function fmt(v: unknown): string { return typeof v === 'string' ? `"${v}"` : String(v); }
function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'a list';
  return typeof v;
}
