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
    // 🔴 The guard has to come BEFORE eq, not after it: eq returned early, so '' and null were
    // still compared and disabled the button with a nonsense reason. And a numeric comparison must
    // accept a number reported as a string — the reporter stringifies anything that is not a bare
    // int/float, so a perfectly ordinary metric can arrive as "0".
    const asNumber = typeof value === 'number' ? value
        : (typeof value === 'string' && value.trim() !== '' && isFinite(Number(value))) ? Number(value)
            : null;
    if (rule.eq !== undefined) {
        if (typeof rule.eq === 'number') {
            if (asNumber === null)
                return OK; // nothing numeric to compare against
            return asNumber === rule.eq ? OK : fail(`expected ${rule.eq}`);
        }
        return String(value) === String(rule.eq) ? OK : fail(`expected "${rule.eq}"`);
    }
    if (asNumber === null)
        return OK;
    // 🔴 Only a real number may be compared. Number('') and Number(null) are both 0, which made an
    // empty or absent value disable the button with the nonsense reason
    // 'last run had issues = "", needs more than 0'. Anything not numeric leaves it enabled: an
    // unnecessary run costs far less than a control nobody can use.
    const num = asNumber;
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