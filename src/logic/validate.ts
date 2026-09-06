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
    const when = b.enableWhen;
    if (when !== undefined) {
      if (!isObject(when)) add('"enableWhen" must be an object like { "metric": "issues", "gt": 0 }.', label);
      else {
        if (!str(when.metric)) add('"enableWhen" needs a "metric" to look at.', label);
        const comparators = ['gt', 'gte', 'lt', 'lte'].filter(k => when[k] !== undefined);
        if (when.eq !== undefined && comparators.length) {
          // eq returns first and the rest are never evaluated, so a rule written this way is
          // silently half-ignored — exactly the quiet failure this module exists to prevent.
          add(`"enableWhen" has both "eq" and ${comparators.map(c => `"${c}"`).join(', ')}; only "eq" is used.`, label);
        }
        if (when.eq === undefined && !comparators.length) add('"enableWhen" has no comparison, so it never disables the button.', label);
      }
    }
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
    // 🔴 ISO 1-7, matching package.json (minimum 1, maximum 7, "1 = Monday … 7 = Sunday"), the
    // README, and dueDate()'s own clamp and default. This alone checked 0-6, so dayOfWeek: 7 -
    // the schema maximum, the documented value for Sunday and the code's default - was reported
    // to the user as an error. Worse, the correction it printed was acted on: 0 validated clean
    // and dueDate clamped it to 1, i.e. MONDAY, flipping a Sunday process to red six days early.
    if (freq === 'weekly' && p.dayOfWeek !== undefined && !isInt(p.dayOfWeek, 1, 7)) {
      add(`has dayOfWeek ${fmt(p.dayOfWeek)}; expected 1 (Monday) to 7 (Sunday).`, label);
    }
    if (p.dueHour !== undefined && !isInt(p.dueHour, 0, 23)) add(`has dueHour ${fmt(p.dueHour)}; expected 0 to 23.`, label);
    if (p.maxMinutes !== undefined && !(typeof p.maxMinutes === 'number' && p.maxMinutes > 0)) {
      add(`has maxMinutes ${fmt(p.maxMinutes)}; expected a positive number of minutes.`, label);
    }
    // 🔴 A dependency that can never resolve is the WORST kind of misconfiguration here, because
    // it fails upwards: an unmatched name leaves the process permanently "blocked", which removes
    // it from the overdue count AND from the coverage denominator. A single typo turned "1
    // overdue, 42% coverage" into "83% coverage" with no warning anywhere.
    if (p.dependsOn !== undefined) {
      if (!Array.isArray(p.dependsOn)) add(`has a "dependsOn" that is ${fmt(p.dependsOn)}; expected a list of process names.`, label);
      else for (const dep of p.dependsOn) {
        if (typeof dep !== 'string' || !dep.trim()) { add(`has a "dependsOn" entry that is ${fmt(dep)}; expected a process name.`, label); continue; }
        // 🔴 Self-dependency is the only thing settings alone can prove wrong. dependsOn lists
        // TASK-name prefixes resolved against RUN HISTORY - README, types.ts and
        // unmetDependencies all agree - so checking them against configured PROCESS names
        // reported a broken dependency for every real reported task the user did not also want
        // a calendar row for. The shipped demo config was itself an instance, and the panel
        // printed "will stay blocked for ever" directly above the row that was working. The
        // genuine typo guard now lives in calendar.ts:unresolvableDependencies, where the run
        // history that can actually answer the question is in scope.
        if (str(p.name) && dep.trim().toLowerCase() === str(p.name).toLowerCase()) {
          add(`depends on itself ("${dep}"), so it can never be anything but blocked.`, label);
        }
      }
    }
    if (p.subtasks !== undefined && !(Array.isArray(p.subtasks) && p.subtasks.every(x => typeof x === 'string' && x.trim()))) {
      add(`has a "subtasks" that is ${fmt(p.subtasks)}; expected a list of task names.`, label);
    }
    return label;
  }));

  // A threshold for a metric that is not tracked is a no-op the user almost certainly did not intend.
  // 🔴 An EMPTY metrics list means every metric, not none. package.json ships
  // deltaTracker.metrics as [] and documents "Empty = every metric present", and
  // renderDeltaTracker implements exactly that. So the documented default way to use this
  // feature - add a threshold, leave metrics alone - raised one problem per threshold, and the
  // card printed "has a threshold but is not in deltaTracker.metrics, so it is never charted or
  // checked" directly above the chart drawing that metric, beside a header reading "1 out of
  // range". The existing test only covered the non-empty case.
  const tracked = Array.isArray(raw.deltaMetrics) ? raw.deltaMetrics.filter(m => typeof m === 'string') : [];
  const thresholds = isObject(raw.deltaThresholds) ? Object.keys(raw.deltaThresholds) : [];
  for (const key of thresholds) {
    if (tracked.length && !tracked.includes(key)) {
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
