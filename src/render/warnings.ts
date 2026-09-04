// Warnings from every running task (or the last one). Hidden entirely when there are none.
import { DashboardData } from '../types';
import { clockTime } from '../logic/time';
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
  const items: string[] = [];
  let total = 0;
  for (const t of sources) {
    const w = t.warnings ?? [];
    total += w.length;
    for (const x of w.slice().reverse()) {
      items.push(`<div class="warning-card"><span class="warning-time">${esc(clockTime(x.time))}</span>${sources.length > 1 ? `<span class="warning-task">${esc(t.task)}</span>` : ''} ${esc(x.msg)}</div>`);
    }
  }
  if (total === 0) return '';
  const shown = items.slice(0, MAX_CARDS);
  const more = items.length > shown.length
    ? `<div class="muted small list-more">${icon('ellipsis')} ${items.length - shown.length} older warning${items.length - shown.length === 1 ? '' : 's'} not shown — the full list is in the run's history row.</div>`
    : '';
  return section('warnings', `Warnings (${total})`, shown.join('') + more, { ...opts, aside: icon('warning', 'status-warn') });
}
