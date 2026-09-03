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
function renderProcessCalendar(data, settings, now) {
    if (settings.processes.length === 0) {
        return (0, html_1.section)('processCalendar', 'Process Calendar', (0, html_1.empty)('No processes configured. Add them under scriptProgress.processCalendar.processes.'));
    }
    const rows = (0, calendar_1.calendarRows)(settings.processes, data.history, now);
    const groups = { daily: [], weekly: [], monthly: [] };
    for (const r of rows)
        (groups[r.process.frequency] ?? groups.monthly).push(r);
    const renderGroup = (title, list) => {
        if (list.length === 0)
            return '';
        const items = list
            .map(r => {
            const m = MARK[r.status];
            return `<div class="cal-row">
  <span class="cal-mark ${m.cls}" title="${m.text}">${(0, html_1.icon)(m.icon)}</span>
  <span class="cal-label" title="${(0, html_1.esc)(r.process.name)}">${(0, html_1.esc)(r.process.label || r.process.name)}</span>
  <span class="cal-note muted">${(0, html_1.esc)(r.note)}</span>
  <span class="cal-last muted" title="Last successful run">${r.lastSuccess ? (0, html_1.esc)((0, time_1.relativeTime)(r.lastSuccess.date, now)) : 'never'}</span>
</div>`;
        })
            .join('');
        return `<div class="cal-group"><div class="cal-group-title">${(0, html_1.esc)(title)}</div>${items}</div>`;
    };
    const overdue = rows.filter(r => r.status === 'overdue').length;
    const title = overdue ? `Process Calendar (${overdue} overdue)` : 'Process Calendar';
    const body = renderGroup('Daily', groups.daily) + renderGroup('Weekly', groups.weekly) + renderGroup('Monthly', groups.monthly);
    return (0, html_1.section)('processCalendar', title, body, overdue ? 'has-overdue' : '');
}
//# sourceMappingURL=processCalendar.js.map