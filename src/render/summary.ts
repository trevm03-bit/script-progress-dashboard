// The summary strip: the numbers worth seeing before anything else.
import { DashboardData, Settings } from '../types';
import { coverageFor, summaryFacts } from '../logic/summary';
import { failurePatterns } from '../logic/failures';
/** run_history.json keeps this many runs; past it, a "last 30 days" count is really "last N runs". */
const HISTORY_CAP = 100;
import { calendarRows } from '../logic/calendar';
import { relativeTime, formatDuration } from '../logic/time';
import { esc, icon } from './html';

/**
 * Tiles worth the room in a narrow sidebar. Nine tiles measured 276px tall at 300px wide — two
 * fifths of the panel, all of it derived numbers, pushing the actual work below the fold.
 */
const SIDEBAR_TILES = 5;

export function renderSummary(data: DashboardData, settings: Settings, now: Date, narrow = false): string {
  const f = summaryFacts(data, settings, now);
  const tiles: string[] = [];
  const tile = (value: string, label: string, cls = '', title = '') => tiles.push(`<div class="tile ${cls}" title="${esc(title)}"><div class="tile-v">${value}</div><div class="tile-l">${esc(label)}</div></div>`);

  // The composite goes FIRST and carries its inputs in the tooltip. A number like this is only
  // honest while the reader can see what went into it.
  let coverageNote = '';
  if (settings.coverage.show && settings.processes.length) {
    // The one shared implementation, so the emailed digest cannot drift away from what is on
    // screen — which it had, by three separate inputs.
    const cov = coverageFor(data, settings, now, { historyCap: HISTORY_CAP, facts: f })!;
    if (cov.percent === null) {
      // 🔴 Three situations produce null and they need three different sentences. Branching on
      // null alone printed the zero-weights one at everybody, so a day-one user who had added a
      // calendar entry and not yet had a run — exactly where the walkthrough leaves them — was
      // told to raise weights that were already the shipped 2/2/1.
      coverageNote = cov.reason === 'no-weight'
        ? `<div class="tiles-note">Coverage is switched on but every weight is 0, so there is nothing to average — raise <code>scriptProgress.coverage.weights</code>, or set <code>coverage.show</code> to false.</div>`
        : `<div class="tiles-note">Coverage has nothing to measure yet — it needs a process that is due, or a run in the last 30 days. It will appear once something has reported.</div>`;
    }
    if (cov.percent !== null) {
      const cls = cov.percent >= 90 ? 'tile-ok' : cov.percent >= 70 ? 'tile-warn' : 'tile-bad';
      // 🔴 The weights of the inputs ACTUALLY USED. Printing all three beside a list of two
      // made the note unverifiable: a reader pairing the two details with the first two weights
      // computes a different percentage from the one on the tile, and the note exists precisely
      // so a screenshot carries its own arithmetic.
      const w = cov.inputs.map(i => i.weight).join('/');
      tile(`${cov.percent}%`, 'coverage', cls, `${cov.inputs.map(i => i.detail).join(' · ')} — weighted ${w}`);
      // 🔴 The inputs go on the PAGE, not only in a tooltip. A screenshot of this strip travels
      // into tickets and decks, and a tooltip does not travel with it — which would leave the
      // number alone, the one thing this figure must never be.
      coverageNote = `<div class="tiles-note">Coverage ${cov.percent}% = ${cov.inputs.map(i => `${esc(i.detail)}`).join(' · ')}<span class="muted"> · weights ${w}</span></div>`;
    }
  }
  if (f.runningCount) tile(`${icon('sync~spin')} ${f.runningCount}`, 'running', 'tile-running');
  if (f.stalledCount) tile(`${icon('warning')} ${f.stalledCount}`, f.stalledCount === 1 ? 'stalled or exited' : 'stalled / exited', 'tile-warn');
  tile(String(f.runsToday), 'runs today');
  tile(String(f.failedToday), 'failed today', f.failedToday ? 'tile-bad' : '');
  tile(String(f.warningsToday), 'warnings today', f.warningsToday ? 'tile-warn' : '');
  if (settings.sections.processCalendar && settings.processes.length) {
    if (f.overdue.length) tile(`${icon('close')} ${f.overdue.length}`, 'overdue', 'tile-bad', f.overdue.join(', '));
    if (f.nextDue) tile(esc(f.nextDue.text.replace(/^due /, '')), `next: ${f.nextDue.label}`, '', `${f.nextDue.label} ${f.nextDue.text}`);
  }
  if (settings.sections.scriptHealth && f.staleScripts.length) tile(String(f.staleScripts.length), 'stale scripts', 'tile-warn', f.staleScripts.join(', '));
  // "metrics out of range" never fit its tile at any width — the tile is sized by its value.
  if (Object.keys(settings.deltas.thresholds || {}).length) tile(String(f.metricsOutOfRange.length), 'out of range', f.metricsOutOfRange.length ? 'tile-bad' : 'tile-ok', `Metrics outside their threshold: ${f.metricsOutOfRange.join(', ') || 'none'}`);
  // A repeated cause is worth more than a count of failures: five stack traces hide the fact
  // that four were the same expired credential.
  const pattern = failurePatterns(data.history, now, 30, 20);
  if (pattern.dominant) {
    tile(`${pattern.dominant.count} of ${pattern.dominant.of}`, `${pattern.dominant.category} failures (30d)`, 'tile-bad',
      `${pattern.dominant.count} of the last ${pattern.dominant.of} failures were "${pattern.dominant.category}" (last 30 days)`);
  }
  if (f.lastRun && !f.runningCount) tile(`${icon(f.lastRun.success ? 'check' : 'error')} ${esc(formatDuration(f.lastRun.elapsed))}`, `last run · ${relativeTime(f.lastRun.date, now)}`, f.lastRun.success ? 'tile-ok' : 'tile-bad', f.lastRun.task);

  const shown = narrow ? tiles.slice(0, SIDEBAR_TILES) : tiles;
  return `<section class="strip" data-section="summary"><div class="tiles">${shown.join('')}</div>${narrow ? '' : coverageNote}</section>`;
}
