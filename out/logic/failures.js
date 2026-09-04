"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UNCATEGORISED = void 0;
exports.failurePatterns = failurePatterns;
exports.patternText = patternText;
const time_1 = require("./time");
exports.UNCATEGORISED = 'uncategorised';
/**
 * Group the most recent `limit` failures by the category their script gave them.
 * `days` bounds how far back to look; 0 means no limit.
 */
function failurePatterns(history, now, days = 30, limit = 20) {
    const cutoff = days > 0 ? now.getTime() - days * 86400000 : -Infinity;
    const failures = history
        .filter(r => !r.success && ((0, time_1.parseIso)(r.date)?.getTime() ?? 0) >= cutoff)
        .sort((a, b) => ((0, time_1.parseIso)(b.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.date)?.getTime() ?? 0))
        .slice(0, limit);
    const byCat = new Map();
    for (const f of failures) {
        const key = (f.category || '').trim() || exports.UNCATEGORISED;
        const list = byCat.get(key);
        if (list)
            list.push(f);
        else
            byCat.set(key, [f]);
    }
    const groups = Array.from(byCat.entries())
        .map(([category, runs]) => ({
        category,
        count: runs.length,
        runs,
        lastSeen: runs[0]?.date ?? '',
        tasks: Array.from(new Set(runs.map(r => r.task))),
    }))
        // Biggest first, but a tie goes to the one that happened most recently.
        .sort((a, b) => b.count - a.count || ((0, time_1.parseIso)(b.lastSeen)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.lastSeen)?.getTime() ?? 0));
    // Only a NAMED category can be a pattern worth reporting, and only when it is more than one
    // of at least two failures: "1 of 1 failures was auth" is noise dressed as insight.
    const top = groups.find(g => g.category !== exports.UNCATEGORISED);
    const dominant = top && top.count >= 2 && failures.length >= 2
        ? { category: top.category, count: top.count, of: failures.length }
        : null;
    return {
        failures,
        groups,
        dominant,
        uncategorised: byCat.get(exports.UNCATEGORISED)?.length ?? 0,
    };
}
/** "3 of the last 5 failures were auth" — or null when there is no pattern to report. */
function patternText(p) {
    if (!p.dominant)
        return null;
    const { category, count, of } = p.dominant;
    return `${count} of the last ${of} failures ${count === 1 ? 'was' : 'were'} ${category}`;
}
//# sourceMappingURL=failures.js.map