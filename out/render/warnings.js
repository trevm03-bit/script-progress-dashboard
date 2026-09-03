"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderWarnings = renderWarnings;
const time_1 = require("../logic/time");
const html_1 = require("./html");
function renderWarnings(data) {
    const w = data.progress?.warnings ?? [];
    if (w.length === 0)
        return '';
    const items = w
        .slice()
        .reverse()
        .map(x => `<div class="warning-card"><span class="warning-time">${(0, html_1.esc)((0, time_1.clockTime)(x.time))}</span> ${(0, html_1.esc)(x.msg)}</div>`)
        .join('');
    return (0, html_1.section)('warnings', `Warnings (${w.length})`, `${(0, html_1.icon)('warning', 'section-icon status-warn')}${items}`);
}
//# sourceMappingURL=warnings.js.map