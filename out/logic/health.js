"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.latestPerTask = latestPerTask;
exports.freshness = freshness;
exports.healthRows = healthRows;
const time_1 = require("./time");
/** Group history by task name; newest run wins. Sorted newest-first. */
function latestPerTask(history) {
    const byTask = new Map();
    for (const r of history) {
        if (!r || !r.task)
            continue;
        const cur = byTask.get(r.task);
        const t = (0, time_1.parseIso)(r.date)?.getTime() ?? 0;
        if (!cur) {
            byTask.set(r.task, { task: r.task, last: r, runs: 1, failures: r.success ? 0 : 1, all: [r] });
        }
        else {
            cur.runs++;
            cur.all.push(r);
            if (!r.success)
                cur.failures++;
            if (t > ((0, time_1.parseIso)(cur.last.date)?.getTime() ?? 0))
                cur.last = r;
        }
    }
    return [...byTask.values()].sort((a, b) => ((0, time_1.parseIso)(b.last.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.last.date)?.getTime() ?? 0));
}
/** fresh = under a quarter of the stale window; aging = under the window; stale = past it. */
function freshness(lastIso, staleHours, now) {
    const d = (0, time_1.parseIso)(lastIso);
    if (!d)
        return { ageHours: Infinity, freshness: 'stale' };
    const ageHours = Math.max(0, (now.getTime() - d.getTime()) / 3600000);
    if (ageHours < staleHours * 0.25)
        return { ageHours, freshness: 'fresh' };
    if (ageHours < staleHours)
        return { ageHours, freshness: 'aging' };
    return { ageHours, freshness: 'stale' };
}
function healthRows(history, staleHours, now, dots = 5) {
    return latestPerTask(history).map(t => {
        const chrono = t.all.slice().sort((a, b) => ((0, time_1.parseIso)(a.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(b.date)?.getTime() ?? 0));
        const durations = chrono.filter(r => r.success && typeof r.elapsed === 'number').map(r => r.elapsed).slice(-20);
        const avgDuration = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
        const recent = chrono.slice(-Math.max(0, dots)).map(r => !!r.success);
        return {
            task: t.task,
            last: t.last,
            runs: t.runs,
            failures: t.failures,
            failureRate: t.runs ? t.failures / t.runs : 0,
            durations,
            avgDuration,
            recent,
            ...freshness(t.last.date, staleHours, now),
        };
    });
}
//# sourceMappingURL=health.js.map