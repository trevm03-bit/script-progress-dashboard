// Warnings from every running task (or the last one). Hidden entirely when there are none.
import { DashboardData } from '../types';
import { clockTime } from '../logic/time';
import { esc, icon, section, SectionOpts } from './html';

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
  return section('warnings', `Warnings (${total})`, items.join(''), { ...opts, aside: icon('warning', 'status-warn') });
}
