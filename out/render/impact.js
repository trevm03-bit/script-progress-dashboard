"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderImpact = renderImpact;
const compliance_1 = require("../logic/compliance");
const sparkline_1 = require("../logic/sparkline");
const time_1 = require("../logic/time");
const html_1 = require("./html");
function renderImpact(data, settings, now, opts) {
    const totals = (0, compliance_1.impactTotals)(data.impact, now);
    if (!totals.length) {
        return (0, html_1.section)('impact', 'Impact Summary', (0, html_1.empty)('Nothing recorded yet. Scripts add to this with Progress.impact("name", value) — a contribution to accumulate, as opposed to a current value to chart.'), opts);
    }
    const cards = totals.map(t => {
        const fmt = settings.deltas.formats?.[t.metric];
        const period = t.thisMonth !== 0
            ? `<div class="imp-sub">${(0, html_1.esc)((0, sparkline_1.formatMetric)(t.thisMonth, fmt))} <span class="muted">this month</span></div>`
            : '<div class="imp-sub muted">nothing this month</div>';
        return `<div class="imp-card">
  <div class="imp-label" title="${(0, html_1.esc)(t.metric)}">${(0, html_1.esc)(t.label)}</div>
  <div class="imp-total">${(0, html_1.esc)((0, sparkline_1.formatMetric)(t.total, fmt))}</div>
  ${period}
  <div class="imp-meta muted small">across ${t.runs} run${t.runs === 1 ? '' : 's'} · last ${(0, html_1.esc)((0, time_1.relativeTime)(t.last, now))}</div>
</div>`;
    }).join('');
    // 🔴 This note is not decoration. A total like this is self-reported by the scripts that
    // produced it, under whatever definition their author chose, and it is exactly the kind of
    // number that gets quoted without its definition. Saying so here is cheaper than defending it
    // later.
    const foot = `<div class="muted small imp-foot">${(0, html_1.icon)('info')}Totals are what your scripts reported, using their own definition of each measure. Write that definition down before quoting a figure.</div>`;
    return (0, html_1.section)('impact', 'Impact Summary', `<div class="imp-grid">${cards}</div>${foot}`, opts);
}
//# sourceMappingURL=impact.js.map