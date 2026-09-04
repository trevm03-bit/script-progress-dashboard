// Process Calendar: expected processes and whether they ran this day / week / month, as a list,
// a month grid per process, or both; with "next due" under each.
import { DashboardData, Settings } from '../types';
import { calendarRows, CalendarStatus, dueText, monthGrid } from '../logic/calendar';
import { relativeTime } from '../logic/time';
import { esc, icon, section, empty, problemList, SectionOpts } from './html';
import { problemsFor } from '../logic/validate';

const MARK: Record<CalendarStatus, { icon: string; cls: string; text: string }> = {
  done: { icon: 'check', cls: 'calendar-done', text: 'done' },
  pending: { icon: 'dash', cls: 'calendar-pending', text: 'pending' },
  overdue: { icon: 'close', cls: 'calendar-overdue', text: 'overdue' },
};

export function renderProcessCalendar(data: DashboardData, settings: Settings, now: Date, opts: SectionOpts, narrow: boolean): string {
  const problems = problemsFor(settings.problems, 'processCalendar');
  if (settings.processes.length === 0) {
    const body = problems.length
      ? problemList(problems) + empty('No usable processes, so nothing is tracked here.')
      : empty('No processes configured yet.', { msg: 'settings', label: 'Add them in Settings', icon: 'settings-gear' });
    return section('processCalendar', 'Process Calendar', body, opts);
  }
  const rows = calendarRows(settings.processes, data.history, now);
  const view = narrow && settings.calendar.view === 'both' ? 'list' : settings.calendar.view;
  const groups: Record<string, typeof rows> = { daily: [], weekly: [], monthly: [] };
  for (const r of rows) (groups[r.process.frequency] ?? groups.monthly).push(r);

  const renderRow = (r: (typeof rows)[number]) => {
    const m = MARK[r.status];
    const grid = view !== 'list' ? monthGridHtml(r.process, data, now) : '';
    const next = settings.calendar.upcoming ? `<span class="cal-next muted">${esc(dueText(r.nextDue, now))}</span>` : '';
    return `<div class="cal-row cal-${r.status}">
  <span class="cal-mark ${m.cls}" title="${m.text}">${icon(m.icon)}</span>
  <span class="cal-label" title="${esc(r.process.name)}">${esc(r.process.label || r.process.name)}</span>
  <span class="cal-note muted">${esc(r.note)}</span>
  ${next}
  <span class="cal-last muted" title="Last successful run">${r.lastSuccess ? esc(relativeTime(r.lastSuccess.date, now)) : 'never'}</span>
  ${grid}
</div>`;
  };
  const renderGroup = (title: string, list: typeof rows) =>
    list.length ? `<div class="cal-group"><div class="cal-group-title">${esc(title)}</div>${list.map(renderRow).join('')}</div>` : '';

  const overdue = rows.filter(r => r.status === 'overdue').length;
  const title = 'Process Calendar';
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const aside = `${overdue ? `<span class="status-fail">${overdue} overdue</span> · ` : ''}<span class="muted">${months[now.getMonth()]} ${now.getFullYear()}</span>`;
  const body = problemList(problems) + renderGroup('Daily', groups.daily) + renderGroup('Weekly', groups.weekly) + renderGroup('Monthly', groups.monthly);
  return section('processCalendar', title, body, { ...opts, cls: overdue ? 'has-overdue' : '', aside });
}

function monthGridHtml(process: Settings['processes'][number], data: DashboardData, now: Date): string {
  const cells = monthGrid(process, data.history, now);
  const first = new Date(now.getFullYear(), now.getMonth(), 1).getDay(); // 0 = Sunday
  const lead = (first + 6) % 7; // Monday-first
  const blanks = Array.from({ length: lead }, () => '<span class="day blank"></span>').join('');
  const days = cells.map(c => {
    const title = `${c.day}: ${c.state === 'future' ? 'upcoming' : c.runs ? `${c.runs} run${c.runs === 1 ? '' : 's'} (${c.state === 'ok' ? 'ok' : 'failed'})` : 'no run'}${c.due ? ' · due' : ''}`;
    return `<span class="day d-${c.state}${c.today ? ' today' : ''}${c.due ? ' due' : ''}" title="${esc(title)}">${c.runs > 1 ? c.runs : ''}</span>`;
  }).join('');
  return `<div class="month-grid" aria-label="Month grid">${blanks}${days}</div>`;
}
