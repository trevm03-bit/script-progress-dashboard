"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderWarnings = renderWarnings;
const time_1 = require("../logic/time");
const html_1 = require("./html");
/**
 * How many warning cards to draw. A diagnostic script legitimately reports hundreds, and every
 * other list in the product is capped (runHistory.maxRows, warningTrends.top, activeTask.logLines,
 * accessMap.maxNodes). Uncapped, 500 warnings produced an 85 KB card that pushed every section
 * below it off the page - so the newest are shown and the rest are counted, not hidden.
 */
const MAX_CARDS = 40;
function renderWarnings(data, opts) {
    const running = data.tasks.filter(t => t.status === 'running');
    const sources = running.length ? running : data.tasks.slice(0, 1);
    const items = [];
    let total = 0;
    for (const t of sources) {
        const w = t.warnings ?? [];
        // The reporter trims this array to 20 and carries the real figure in warningsTotal. Using
        // the array length here made the header disagree with the summary tile and the Run History
        // column, which already used the total - one page, one run, two numbers.
        total += Math.max(t.warningsTotal ?? 0, w.length);
        for (const x of w.slice().reverse()) {
            items.push(`<div class="warning-card"><span class="warning-time">${(0, html_1.esc)((0, time_1.clockTime)(x.time))}</span>${sources.length > 1 ? `<span class="warning-task">${(0, html_1.esc)(t.task)}</span>` : ''} ${(0, html_1.esc)(x.msg)}</div>`);
        }
    }
    if (total === 0)
        return '';
    const shown = items.slice(0, MAX_CARDS);
    const more = items.length > shown.length
        ? `<div class="muted small list-more">${(0, html_1.icon)('ellipsis')} ${items.length - shown.length} older warning${items.length - shown.length === 1 ? '' : 's'} not shown — the full list is in the run's history row.</div>`
        : '';
    return (0, html_1.section)('warnings', `Warnings (${total})`, shown.join('') + more, { ...opts, aside: (0, html_1.icon)('warning', 'status-warn') });
}
//# sourceMappingURL=warnings.js.map