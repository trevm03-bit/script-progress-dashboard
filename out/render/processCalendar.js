"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderProcessCalendar = renderProcessCalendar;
const calendar_1 = require("../logic/calendar");
const time_1 = require("../logic/time");
const html_1 = require("./html");
const validate_1 = require("../logic/validate");
const compliance_1 = require("../logic/compliance");
const MARK = {
    done: { icon: 'check', cls: 'calendar-done', text: 'done' },
    partial: { icon: 'circle-half', cls: 'calendar-partial', text: 'part done' },
    pending: { icon: 'dash', cls: 'calendar-pending', text: 'pending' },
    overdue: { icon: 'close', cls: 'calendar-overdue', text: 'overdue' },
    blocked: { icon: 'circle-slash', cls: 'calendar-blocked', text: 'waiting on something upstream' },
    unseen: { icon: 'question', cls: 'calendar-unseen', text: 'never reported' },
};
function renderProcessCalendar(data, settings, now, opts, narrow) {
    const problems = (0, validate_1.problemsFor)(settings.problems, 'processCalendar');
    if (settings.processes.length === 0) {
        const body = problems.length
            ? (0, html_1.problemList)(problems) + (0, html_1.empty)('No usable processes, so nothing is tracked here.')
            : (0, html_1.empty)('No processes configured yet.', { msg: 'settings', label: 'Add them in Settings', icon: 'settings-gear' });
        return (0, html_1.section)('processCalendar', 'Process Calendar', body, opts);
    }
    const rows = (0, calendar_1.calendarRows)(settings.processes, data.history, now);
    const view = narrow && settings.calendar.view === 'both' ? 'list' : settings.calendar.view;
    const groups = { daily: [], weekly: [], monthly: [] };
    for (const r of rows)
        (groups[r.process.frequency] ?? groups.monthly).push(r);
    const renderRow = (r) => {
        const m = MARK[r.status];
        const grid = view !== 'list' ? monthGridHtml(r.process, data, now) : '';
        // An unseen process has no meaningful "next due" — nothing has ever reported it — but the
        // column still has to exist so the rows stay aligned.
        const next = !settings.calendar.upcoming ? ''
            : r.status === 'unseen' ? '<span class="cal-next"></span>'
                : `<span class="cal-next muted">${(0, html_1.esc)((0, calendar_1.dueText)(r.nextDue, now))}</span>`;
        // Reliability over time, beside today's state. A run of green squares says "this has been
        // holding" in a way a single status never can.
        const comp = settings.calendar.compliance ? (0, compliance_1.complianceReport)(r.process, data.history, now, settings.calendar.compliancePeriods) : null;
        const sla = comp && comp.percent !== null
            ? `<span class="cal-sla" title="${(0, html_1.esc)(comp.periods.map(p => `${p.label}: ${!p.known ? 'before it was wired' : p.met ? 'ran' : 'MISSED'}`).join(' · '))}">`
                + comp.periods.map(p => `<span class="sla-dot${!p.known ? ' sla-unknown' : p.met ? ' sla-met' : ' sla-missed'}"></span>`).join('')
                + `<span class="sla-pct ${comp.percent >= 90 ? 'status-pass' : comp.percent >= 70 ? 'status-warn' : 'status-fail'}">${comp.percent}%</span></span>`
            : '';
        const phases = r.phases.length
            ? `<span class="cal-phases" title="${(0, html_1.esc)(r.phases.map(p => `${p.done ? 'done' : 'not yet'}: ${p.name}`).join(' · '))}">${r.phases.map(p => `<span class="phase-pip${p.done ? ' on' : ''}"></span>`).join('')}</span>`
            : '';
        const last = r.status === 'unseen'
            ? `<span class="cal-last muted" title="No run has ever reported a task name starting with &quot;${(0, html_1.esc)(r.process.name)}&quot;">not wired yet</span>`
            : `<span class="cal-last muted" title="Last successful run">${r.lastSuccess ? (0, html_1.esc)((0, time_1.relativeTime)(r.lastSuccess.date, now)) : 'never'}</span>`;
        return `<div class="cal-row cal-${r.status}">
  <span class="cal-mark ${m.cls}" title="${m.text}">${(0, html_1.icon)(m.icon)}</span>
  <span class="cal-label" title="${(0, html_1.esc)(r.process.name)}">${(0, html_1.esc)(r.process.label || r.process.name)}${phases}</span>
  <span class="cal-note muted">${(0, html_1.esc)(r.note)}</span>
  ${sla}
  ${next}
  ${last}
  ${grid}
</div>`;
    };
    const renderGroup = (title, list) => list.length ? `<div class="cal-group"><div class="cal-group-title">${(0, html_1.esc)(title)}</div>${list.map(renderRow).join('')}</div>` : '';
    const overdue = rows.filter(r => r.status === 'overdue').length;
    const unseen = rows.filter(r => r.status === 'unseen').length;
    const blocked = rows.filter(r => r.status === 'blocked').length;
    const title = 'Process Calendar';
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const aside = `${overdue ? `<span class="status-fail">${overdue} overdue</span> · ` : ''}${blocked ? `<span class="calendar-blocked">${blocked} blocked</span> · ` : ''}${unseen ? `<span class="muted">${unseen} not wired yet</span> · ` : ''}<span class="muted">${months[now.getMonth()]} ${now.getFullYear()}</span>`;
    const body = (0, html_1.problemList)(problems) + renderGroup('Daily', groups.daily) + renderGroup('Weekly', groups.weekly) + renderGroup('Monthly', groups.monthly);
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