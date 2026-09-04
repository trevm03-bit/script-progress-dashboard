// The summary strip: the numbers worth seeing before anything else.
import { DashboardData, Settings } from '../types';
import { summaryFacts } from '../logic/summary';
import { failurePatterns } from '../logic/failures';
import { coverage } from '../logic/compliance';
import { calendarRows } from '../logic/calendar';
import { relativeTime, formatDuration } from '../logic/time';
import { esc, icon } from './html';

export function renderSummary(data: DashboardData, settings: Settings, now: Date): string {
  const f = summaryFacts(data, settings, now);
  const tiles: string[] = [];
  const tile = (value: string, label: string, cls = '', title = '') => tiles.push(`<div class="tile ${cls}" title="${esc(title)}"><div class="tile-v">${value}</div><div class="tile-l">${esc(label)}</div></div>`);

  // The composite goes FIRST and carries its inputs in the tooltip. A number like this is only
  // honest while the reader can see what went into it.
  if (settings.coverage.show && settings.processes.length) {
    const cov = coverage(calendarRows(settings.processes, data.history, now), data.history,
      f.metricsOutOfRange.length, Object.keys(settings.deltas.thresholds || {}).length, now);
    if (cov.percent !== null) {
      const cls = cov.percent >= 90 ? 'tile-ok' : cov.percent >= 70 ? 'tile-warn' : 'tile-bad';
      tile(`${cov.percent}%`, 'coverage', cls, cov.inputs.map(i => i.detail).join(' · '));
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
  if (Object.keys(settings.deltas.thresholds || {}).length) tile(String(f.metricsOutOfRange.length), 'metrics out of range', f.metricsOutOfRange.length ? 'tile-bad' : 'tile-ok', f.metricsOutOfRange.join(', '));
  // A repeated cause is worth more than a count of failures: five stack traces hide the fact
  // that four were the same expired credential.
  const pattern = failurePatterns(data.history, now, 30, 20);
  if (pattern.dominant) {
    tile(`${pattern.dominant.count}/${pattern.dominant.of}`, `failures: ${pattern.dominant.category}`, 'tile-bad',
      `${pattern.dominant.count} of the last ${pattern.dominant.of} failures were "${pattern.dominant.category}" (last 30 days)`);
  }
  if (f.lastRun && !f.runningCount) tile(`${icon(f.lastRun.success ? 'check' : 'error')} ${esc(formatDuration(f.lastRun.elapsed))}`, `last run · ${relativeTime(f.lastRun.date, now)}`, f.lastRun.success ? 'tile-ok' : 'tile-bad', f.lastRun.task);

  return `<section class="strip" data-section="summary"><div class="tiles">${tiles.join('')}</div></section>`;
}
