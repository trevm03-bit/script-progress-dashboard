// Process Calendar: expected processes and whether they ran this day / week / month.
import { DashboardData, Settings } from '../types';
import { calendarRows, CalendarStatus } from '../logic/calendar';
import { relativeTime } from '../logic/time';
import { esc, icon, section, empty } from './html';

const MARK: Record<CalendarStatus, { icon: string; cls: string; text: string }> = {
  done: { icon: 'check', cls: 'calendar-done', text: 'done' },
  pending: { icon: 'dash', cls: 'calendar-pending', text: 'pending' },
  overdue: { icon: 'close', cls: 'calendar-overdue', text: 'overdue' },
};

export function renderProcessCalendar(data: DashboardData, settings: Settings, now: Date): string {
  if (settings.processes.length === 0) {
    return section('processCalendar', 'Process Calendar', empty('No processes configured. Add them under scriptProgress.processCalendar.processes.'));
  }
  const rows = calendarRows(settings.processes, data.history, now);
  const groups: Record<string, typeof rows> = { daily: [], weekly: [], monthly: [] };
  for (const r of rows) (groups[r.process.frequency] ?? groups.monthly).push(r);

  const renderGroup = (title: string, list: typeof rows) => {
    if (list.length === 0) return '';
    const items = list
      .map(r => {
        const m = MARK[r.status];
        return `<div class="cal-row">
  <span class="cal-mark ${m.cls}" title="${m.text}">${icon(m.icon)}</span>
  <span class="cal-label" title="${esc(r.process.name)}">${esc(r.process.label || r.process.name)}</span>
  <span class="cal-note muted">${esc(r.note)}</span>
  <span class="cal-last muted" title="Last successful run">${r.lastSuccess ? esc(relativeTime(r.lastSuccess.date, now)) : 'never'}</span>
</div>`;
      })
      .join('');
    return `<div class="cal-group"><div class="cal-group-title">${esc(title)}</div>${items}</div>`;
  };

  const overdue = rows.filter(r => r.status === 'overdue').length;
  const title = overdue ? `Process Calendar (${overdue} overdue)` : 'Process Calendar';
  const body = renderGroup('Daily', groups.daily) + renderGroup('Weekly', groups.weekly) + renderGroup('Monthly', groups.monthly);
  return section('processCalendar', title, body, overdue ? 'has-overdue' : '');
}
