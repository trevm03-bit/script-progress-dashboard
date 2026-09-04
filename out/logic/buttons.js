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
    const shown = typeof value === 'number' ? String(value) : `"${value}"`;
    const fail = (test) => ({ enabled: false, reason: `last run had ${rule.metric} = ${shown}, ${test}` });
    if (rule.eq !== undefined) {
        const same = typeof rule.eq === 'number' ? value === rule.eq : String(value) === String(rule.eq);
        return same ? OK : fail(`expected ${typeof rule.eq === 'number' ? rule.eq : `"${rule.eq}"`}`);
    }
    // 🔴 Only a real number may be compared. Number('') and Number(null) are both 0, which made an
    // empty or absent value disable the button with the nonsense reason
    // 'last run had issues = "", needs more than 0'. Anything not numeric leaves it enabled: an
    // unnecessary run costs far less than a control nobody can use.
    if (typeof value !== 'number' || !isFinite(value))
        return OK;
    const num = value;
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