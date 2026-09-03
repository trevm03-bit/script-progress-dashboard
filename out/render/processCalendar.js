"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderProcessCalendar = renderProcessCalendar;
const calendar_1 = require("../logic/calendar");
const time_1 = require("../logic/time");
const html_1 = require("./html");
const MARK = {
    done: { icon: 'check', cls: 'calendar-done', text: 'done' },
    pending: { icon: 'dash', cls: 'calendar-pending', text: 'pending' },
    overdue: { icon: 'close', cls: 'calendar-overdue', text: 'overdue' },
};
function renderProcessCalendar(data, settings, now, opts, narrow) {
    if (settings.processes.length === 0) {
        return (0, html_1.section)('processCalendar', 'Process Calendar', (0, html_1.empty)('No processes configured yet.', { msg: 'settings', label: 'Add them in Settings', icon: 'settings-gear' }), opts);
    }
    const rows = (0, calendar_1.calendarRows)(settings.processes, data.history, now);
    const view = narrow && settings.calendar.view === 'both' ? 'list' : settings.calendar.view;
    const groups = { daily: [], weekly: [], monthly: [] };
    for (const r of rows)
        (groups[r.process.frequency] ?? groups.monthly).push(r);
    const renderRow = (r) => {
        const m = MARK[r.status];
        const grid = view !== 'list' ? monthGridHtml(r.process, data, now) : '';
        const next = settings.calendar.upcoming ? `<span class="cal-next muted">${(0, html_1.esc)((0, calendar_1.dueText)(r.nextDue, now))}</span>` : '';
        return `<div class="cal-row cal-${r.status}">
  <span class="cal-mark ${m.cls}" title="${m.text}">${(0, html_1.icon)(m.icon)}</span>
  <span class="cal-label" title="${(0, html_1.esc)(r.process.name)}">${(0, html_1.esc)(r.process.label || r.process.name)}</span>
  <span class="cal-note muted">${(0, html_1.esc)(r.note)}</span>
  ${next}
  <span class="cal-last muted" title="Last successful run">${r.lastSuccess ? (0, html_1.esc)((0, time_1.relativeTime)(r.lastSuccess.date, now)) : 'never'}</span>
  ${grid}
</div>`;
    };
    const renderGroup = (title, list) => list.length ? `<div class="cal-group"><div class="cal-group-title">${(0, html_1.esc)(title)}</div>${list.map(renderRow).join('')}</div>` : '';
    const overdue = rows.filter(r => r.status === 'overdue').length;
    const title = 'Process Calendar';
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const aside = `${overdue ? `<span class="status-fail">${overdue} overdue</span> · ` : ''}<span class="muted">${months[now.getMonth()]} ${now.getFullYear()}</span>`;
    const body = renderGroup('Daily', groups.daily) + renderGroup('Weekly', groups.weekly) + renderGroup('Monthly', groups.monthly);
    return (0, html_1.section)('processCalendar', title, body, { ...opts, cls: overdue ? 'has-overdue' : '', aside });
}
function monthGridHtml(process, data, now) {
    const cells = (0, calendar_1.monthGrid)(process, data.history, now);
    const first = new Date(now.getFullYear(), now.getMonth(), 1).getDay(); // 0 = Sunday
    const lead = (first + 6) % 7; // Monday-first
    const blanks = Array.from({ length: lead }, () => '<span class="day blank"></span>').join('');
    const days = cells.map(c => {
        const title = `${c.day}: ${c.state === 'future' ? 'upcoming' : c.runs ? `${c.runs} run${c.runs === 1 ? '' : 's'} (${c.state === 'ok' ? 'ok' : 'failed'})` : 'no run'}${c.due ? ' · due' : ''}`;
        return `<span class="day d-${c.state}${c.today ? ' today' : ''}${c.due ? ' due' : ''}" title="${(0, html_1.esc)(title)}">${c.runs > 1 ? c.runs : ''}</span>`;
    }).join('');
    return `<div class="month-grid" aria-label="Month grid">${blanks}${days}</div>`;
}
//# sourceMappingURL=processCalendar.js.map