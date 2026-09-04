"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buttonEnabled = buttonEnabled;
const calendar_1 = require("./calendar");
const time_1 = require("./time");
const OK = { enabled: true, reason: '' };
/**
 * Decide from the latest SUCCESSFUL run of the named task. Unknown means ENABLED: a rule that
 * silently disables a button because no run has happened yet would make a fresh install look
 * broken, and the cost of an unnecessary run is far smaller than the cost of a control nobody
 * can use.
 */
function buttonEnabled(rule, fallbackTask, history) {
    if (!rule || !rule.metric)
        return OK;
    const task = (rule.task || fallbackTask || '').trim();
    if (!task)
        return OK;
    const latest = history
        .filter(r => r.success && (0, calendar_1.matchesProcess)(r.task, { name: task, label: task, frequency: 'daily' }))
        .sort((a, b) => ((0, time_1.parseIso)(b.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.date)?.getTime() ?? 0))[0];
    if (!latest)
        return OK;
    const value = latest.metrics?.[rule.metric];
    if (value === undefined)
        return OK;
    const num = typeof value === 'number' ? value : Number(value);
    const shown = typeof value === 'number' ? String(value) : `"${value}"`;
    const fail = (test) => ({ enabled: false, reason: `last run had ${rule.metric} = ${shown}, ${test}` });
    if (rule.eq !== undefined) {
        const same = typeof rule.eq === 'number' ? num === rule.eq : String(value) === String(rule.eq);
        return same ? OK : fail(`expected ${typeof rule.eq === 'number' ? rule.eq : `"${rule.eq}"`}`);
    }
    if (!isFinite(num))
        return OK; // a text metric cannot be compared numerically
    if (rule.gt !== undefined && !(num > rule.gt))
        return fail(`needs more than ${rule.gt}`);
    if (rule.gte !== undefined && !(num >= rule.gte))
        return fail(`needs at least ${rule.gte}`);
    if (rule.lt !== undefined && !(num < rule.lt))
        return fail(`needs less than ${rule.lt}`);
    if (rule.lte !== undefined && !(num <= rule.lte))
        return fail(`needs at most ${rule.lte}`);
    return OK;
}
//# sourceMappingURL=buttons.js.map