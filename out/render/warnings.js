"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderWarnings = renderWarnings;
const time_1 = require("../logic/time");
const html_1 = require("./html");
function renderWarnings(data, opts) {
    const running = data.tasks.filter(t => t.status === 'running');
    const sources = running.length ? running : data.tasks.slice(0, 1);
    const items = [];
    let total = 0;
    for (const t of sources) {
        const w = t.warnings ?? [];
        total += w.length;
        for (const x of w.slice().reverse()) {
            items.push(`<div class="warning-card"><span class="warning-time">${(0, html_1.esc)((0, time_1.clockTime)(x.time))}</span>${sources.length > 1 ? `<span class="warning-task">${(0, html_1.esc)(t.task)}</span>` : ''} ${(0, html_1.esc)(x.msg)}</div>`);
        }
    }
    if (total === 0)
        return '';
    return (0, html_1.section)('warnings', `Warnings (${total})`, items.join(''), { ...opts, aside: (0, html_1.icon)('warning', 'status-warn') });
}
//# sourceMappingURL=warnings.js.map