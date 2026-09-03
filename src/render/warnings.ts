// Warnings from the current run. Hidden entirely when there are none.
import { DashboardData } from '../types';
import { clockTime } from '../logic/time';
import { esc, icon, section } from './html';

export function renderWarnings(data: DashboardData): string {
  const w = data.progress?.warnings ?? [];
  if (w.length === 0) return '';
  const items = w
    .slice()
    .reverse()
    .map(x => `<div class="warning-card"><span class="warning-time">${esc(clockTime(x.time))}</span> ${esc(x.msg)}</div>`)
    .join('');
  return section('warnings', `Warnings (${w.length})`, `${icon('warning', 'section-icon status-warn')}${items}`);
}
