// Warnings from every running task (or the last one). Hidden entirely when there are none.
import { DashboardData } from '../types';
import { clockTime, parseIso } from '../logic/time';
import { esc, icon, section, SectionOpts } from './html';

/**
 * How many warning cards to draw. A diagnostic script legitimately reports hundreds, and every
 * other list in the product is capped (runHistory.maxRows, warningTrends.top, activeTask.logLines,
 * accessMap.maxNodes). Uncapped, 500 warnings produced an 85 KB card that pushed every section
 * below it off the page - so the newest are shown and the rest are counted, not hidden.
 */
const MAX_CARDS = 40;

export function renderWarnings(data: DashboardData, opts: SectionOpts): string {
  const running = data.tasks.filter(t => t.status === 'running');
  const sources = running.length ? running : data.tasks.slice(0, 1);
  // 🔴 Collected across every running script FIRST, then sorted newest-first, then capped.
  //
  // The list used to be built by concatenating each task's warnings in slot order, so
  // slice(0, 40) meant "the first 40 of task A", not "the 40 newest". With three scripts
  // running the card said "Warnings (60)", drew 40, and one script was completely absent -
  // nothing on the card even named it - while the footer called the vanished ones "older"
  // though many had been raised AFTER the ones on screen. A diagnostic script that raises 40
  // warnings hid every warning from the job the user was actually watching.
  //
  // Entries are shape-checked as they are read: one null in one slot's array threw a TypeError
  // out of renderSections, and nothing above catches it, so the webview froze on its last-good
  // HTML for ever with no error anywhere.
  const items: { task: string; time: string; msg: string; at: number }[] = [];
  let total = 0;
  for (const t of sources) {
    const w = Array.isArray(t.warnings) ? t.warnings : [];
    // The reporter trims this array to 20 and carries the real figure in warningsTotal. Using
    // the array length here made the header disagree with the summary tile and the Run History
    // column, which already used the total - one page, one run, two numbers.
    total += Math.max(t.warningsTotal ?? 0, w.length);
    for (const x of w) {
      if (!x || typeof x !== 'object') continue;
      items.push({ task: t.task, time: String(x.time ?? ''), msg: String(x.msg ?? ''),
        at: parseIso(x.time)?.getTime() ?? 0 });
    }
  }
  if (total === 0) return '';
  items.sort((a, b) => b.at - a.at);
  const shown = items.slice(0, MAX_CARDS).map(x =>
    `<div class="warning-card"><span class="warning-time">${esc(clockTime(x.time))}</span>${sources.length > 1 ? `<span class="warning-task">${esc(x.task)}</span>` : ''} ${esc(x.msg)}</div>`);
  const hidden = items.length - Math.min(items.length, MAX_CARDS);
  const more = hidden > 0
    ? `<div class="muted small list-more">${icon('ellipsis')} ${hidden} older warning${hidden === 1 ? '' : 's'} not shown — the full list is in the run's history row.</div>`
    : '';
  return section('warnings', `Warnings (${total})`, shown.join('') + more, { ...opts, aside: icon('warning', 'status-warn') });
}
