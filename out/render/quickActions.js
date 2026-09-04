"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderQuickActions = renderQuickActions;
const time_1 = require("../logic/time");
const html_1 = require("./html");
const validate_1 = require("../logic/validate");
function renderQuickActions(data, settings, now, trusted, opts) {
    const problems = (0, validate_1.problemsFor)(settings.problems, 'quickActions');
    if (settings.buttons.length === 0) {
        // Distinguish "not set up" from "set up wrongly" — they need opposite responses.
        const body = problems.length
            ? (0, html_1.problemList)(problems) + (0, html_1.empty)('No usable buttons, so nothing is shown here.')
            : (0, html_1.empty)('No buttons configured yet.', { msg: 'settings', label: 'Add them in Settings', icon: 'settings-gear' });
        return (0, html_1.section)('quickActions', 'Quick Actions', body, opts);
    }
    const running = new Set(data.tasks.filter(t => (0, time_1.taskState)(t, settings.staleRunningMinutes, now, data.overlays) === 'running').map(t => t.task.toLowerCase()));
    const lastByTask = new Map();
    for (const r of data.history) {
        const k = r.task.toLowerCase();
        const cur = lastByTask.get(k);
        if (!cur || ((0, time_1.parseIso)(r.date)?.getTime() ?? 0) > ((0, time_1.parseIso)(cur.date)?.getTime() ?? 0))
            lastByTask.set(k, { success: r.success, date: r.date });
    }
    const groups = new Map();
    settings.buttons.forEach((b, index) => {
        const g = b.group || '';
        if (!groups.has(g))
            groups.set(g, []);
        groups.get(g).push(index);
    });
    let body = (0, html_1.problemList)(problems);
    for (const [group, indexes] of groups) {
        if (group)
            body += `<div class="btn-group-label">${(0, html_1.esc)(group)}</div>`;
        body += `<div class="btn-row">`;
        for (const index of indexes) {
            const b = settings.buttons[index];
            const taskKey = b.task || '';
            const isRunning = !!taskKey && [...running].some(t => (0, time_1.taskMatches)(t, taskKey));
            const disabled = !trusted || (settings.quickActions.disableWhileRunning && isRunning);
            const last = taskKey ? [...lastByTask.entries()].filter(([k]) => (0, time_1.taskMatches)(k, taskKey)).map(([, v]) => v).sort((a, b2) => ((0, time_1.parseIso)(b2.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.date)?.getTime() ?? 0))[0] : undefined;
            const status = isRunning
                ? `<span class="btn-status">${(0, html_1.icon)('sync~spin')} running</span>`
                : last ? `<span class="btn-status ${last.success ? 'status-pass' : 'status-fail'}" title="Last run">${(0, html_1.icon)(last.success ? 'check' : 'error')} ${(0, html_1.esc)((0, time_1.relativeTime)(last.date, now))}</span>` : '';
            body += `<div class="btn-cell"><button class="btn" data-action="${index}" title="${(0, html_1.esc)(b.command)}" ${disabled ? 'disabled' : ''}>${(0, html_1.icon)(b.icon)}<span>${(0, html_1.esc)(b.label)}</span>${b.confirm === false ? (0, html_1.icon)('zap', 'btn-hint') : ''}</button>${status}</div>`;
        }
        body += `</div>`;
    }
    if (!trusted)
        body += `<div class="muted small">${(0, html_1.icon)('shield')} Workspace is not trusted — buttons are disabled until you trust it.</div>`;
    const aside = settings.quickActions.runVia === 'task' ? `<span class="muted">${(0, html_1.icon)('tasklist')} as tasks</span>` : '';
    return (0, html_1.section)('quickActions', 'Quick Actions', body, { ...opts, aside });
}
//# sourceMappingURL=quickActions.js.map