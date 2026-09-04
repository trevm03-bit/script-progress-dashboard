"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderImpact = renderImpact;
const compliance_1 = require("../logic/compliance");
const sparkline_1 = require("../logic/sparkline");
const time_1 = require("../logic/time");
const html_1 = require("./html");
function renderImpact(data, settings, now, opts) {
    const totals = (0, compliance_1.impactTotals)(data.impact, now, data.history);
    if (!totals.length) {
        return (0, html_1.section)('impact', 'Impact Summary', (0, html_1.empty)('Nothing recorded yet. Scripts add to this with Progress.impact("name", value) — a contribution to accumulate, as opposed to a current value to chart.', { msg: 'walkthrough', label: 'Getting started', icon: 'book' }), opts);
    }
    // 24 cards is already a wall; beyond that the section stops being a summary.
    const MAX_CARDS = 24;
    const hidden = Math.max(0, totals.length - MAX_CARDS);
    const cards = totals.slice(0, MAX_CARDS).map(t => {
        const fmt = settings.deltas.formats?.[t.metric];
        // An unrenderable total (an overflow) must not then claim a monthly figure it cannot show.
        const showMonth = isFinite(t.thisMonth) && t.thisMonth !== 0 && isFinite(t.total);
        const period = showMonth
            ? `<div class="imp-sub">${(0, html_1.esc)((0, sparkline_1.formatMetric)(t.thisMonth, fmt))} <span class="muted">this month</span></div>`
            : '<div class="imp-sub muted">nothing this month</div>';
        return `<div class="imp-card">
  <div class="imp-label" title="${(0, html_1.esc)(t.metric)}">${(0, html_1.esc)(t.label)}</div>
  <div class="imp-total">${(0, html_1.esc)((0, sparkline_1.formatMetric)(t.total, fmt))}<span class="imp-unit"> total</span></div>
  ${t.thisMonth === t.total ? '' : period}
  <div class="imp-meta muted small">across ${t.runs} run${t.runs === 1 ? '' : 's'} · last ${(0, html_1.esc)((0, time_1.relativeTime)(t.last, now))}</div>
</div>`;
    }).join('');
    // 🔴 This note is not decoration. A total like this is self-reported by the scripts that
    // produced it, under whatever definition their author chose, and it is exactly the kind of
    // number that gets quoted without its definition. Saying so here is cheaper than defending it
    // later.
    const foot = `<div class="muted small imp-foot">${(0, html_1.icon)('info')}<span>Totals are what your scripts reported, using their own definition of each measure.</span></div>`;
    const more = hidden ? `<div class="muted small list-more">${(0, html_1.icon)('ellipsis')} ${hidden} more measure${hidden === 1 ? '' : 's'} not shown.</div>` : '';
    return (0, html_1.section)('impact', 'Impact Summary', `<div class="imp-grid">${cards}</div>${more}${foot}`, opts);
}
//# sourceMappingURL=impact.js.map