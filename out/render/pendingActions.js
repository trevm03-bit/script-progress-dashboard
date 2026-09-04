"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderPendingActions = renderPendingActions;
const compliance_1 = require("../logic/compliance");
const time_1 = require("../logic/time");
const html_1 = require("./html");
function renderPendingActions(data, settings, now, opts) {
    const items = (0, compliance_1.pendingActions)(data.history, now, settings.pendingActions.maxAgeDays);
    if (!items.length) {
        // Distinguish "nothing outstanding" from "nothing ever marked actionable" — the second is a
        // wiring gap, and telling someone their to-do list is empty when nothing can reach it is a
        // small lie that takes a long time to notice.
        const everMarked = data.history.some(r => Array.isArray(r.warningItems) && r.warningItems.some(w => w?.actionable));
        const body = everMarked
            ? (0, html_1.empty)('Nothing outstanding — the last successful run of every script reported no actionable findings.')
            : (0, html_1.empty)('Nothing is marked as needing action yet. Mark a finding with Progress.warn("…", actionable=True) and it will appear here.', { msg: 'walkthrough', label: 'Getting started', icon: 'book' });
        return (0, html_1.section)('pendingActions', 'Pending Actions', body, opts);
    }
    const byTask = new Map();
    for (const it of items) {
        const list = byTask.get(it.task);
        if (list)
            list.push(it);
        else
            byTask.set(it.task, [it]);
    }
    let body = '';
    for (const [task, list] of byTask) {
        body += `<div class="pa-group"><div class="pa-task">${(0, html_1.esc)(task)} <span class="muted small">${(0, html_1.esc)((0, time_1.relativeTime)(list[0].date, now))}</span></div>`;
        for (const it of list) {
            const sev = it.severity === 'error' ? 'pa-error' : it.severity === 'info' ? 'pa-info' : 'pa-warn';
            const count = typeof it.count === 'number' ? `<span class="pa-count">${it.count}</span>` : '';
            const cat = it.category ? `<span class="pa-cat">${(0, html_1.esc)(it.category)}</span>` : '';
            body += `<div class="pa-item ${sev}" title="${(0, html_1.esc)(`Reported ${(0, time_1.clockTime)(it.time)} by ${it.task}`)}">${(0, html_1.icon)('circle-outline')}${count}<span class="pa-msg">${(0, html_1.esc)(it.msg)}</span>${cat}</div>`;
        }
        body += '</div>';
    }
    body += `<div class="muted small pa-foot">${(0, html_1.icon)('info')}<span>An item disappears when a later <b>successful</b> run of that script stops reporting it. A failed run never clears one.</span></div>`;
    return (0, html_1.section)('pendingActions', 'Pending Actions', body, {
        ...opts,
        aside: `<span class="status-warn">${items.length}</span>`,
    });
}
//# sourceMappingURL=pendingActions.js.map