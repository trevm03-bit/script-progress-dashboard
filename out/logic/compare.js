"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.compareRuns = compareRuns;
exports.defaultBaseline = defaultBaseline;
exports.findRun = findRun;
exports.runKey = runKey;
const time_1 = require("./time");
/**
 * Compare run `a` (the baseline) with run `b`. Order is respected exactly as given — the caller
 * decides which is the baseline — but `bIsNewer` records what the dates say, so a UI can warn
 * when someone compares backwards without silently reordering their choice for them.
 */
function compareRuns(a, b) {
    const ta = (0, time_1.parseIso)(a.date)?.getTime() ?? 0;
    const tb = (0, time_1.parseIso)(b.date)?.getTime() ?? 0;
    const keys = Array.from(new Set([...Object.keys(a.metrics ?? {}), ...Object.keys(b.metrics ?? {})])).sort();
    const metrics = keys.map(key => {
        const va = a.metrics?.[key];
        const vb = b.metrics?.[key];
        let delta = null;
        let pct = null;
        let direction;
        if (va === undefined)
            direction = 'new';
        else if (vb === undefined)
            direction = 'gone';
        else if (typeof va === 'number' && typeof vb === 'number') {
            delta = vb - va;
            pct = va !== 0 ? (delta / Math.abs(va)) * 100 : null;
            direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'same';
        }
        else {
            direction = String(va) === String(vb) ? 'same' : 'up';
        }
        return { key, a: va, b: vb, delta, pct, direction };
    });
    const wa = messages(a);
    const wb = messages(b);
    const setA = new Set(wa);
    const setB = new Set(wb);
    const warnings = {
        added: wb.filter(m => !setA.has(m)),
        resolved: wa.filter(m => !setB.has(m)),
        unchanged: wb.filter(m => setA.has(m)),
    };
    const ea = Number(a.elapsed) || 0;
    const eb = Number(b.elapsed) || 0;
    const touchedA = new Set(a.accessed ?? []);
    const touchedB = new Set(b.accessed ?? []);
    return {
        a, b,
        bIsNewer: tb >= ta,
        sameTask: (a.task || '').toLowerCase() === (b.task || '').toLowerCase(),
        metrics,
        warnings,
        durationDelta: Math.round((eb - ea) * 10) / 10,
        durationPct: ea > 0 ? ((eb - ea) / ea) * 100 : null,
        outcomeChanged: !!a.success !== !!b.success,
        touchedAdded: (b.accessed ?? []).filter(id => !touchedA.has(id)),
        touchedRemoved: (a.accessed ?? []).filter(id => !touchedB.has(id)),
    };
}
/**
 * The run to compare against by default: the previous run of the same task. Falls back to the
 * previous run of anything only when the task has no earlier run, because comparing two
 * different scripts is rarely what anyone means.
 */
function defaultBaseline(run, history) {
    const t = (0, time_1.parseIso)(run.date)?.getTime() ?? 0;
    const earlier = history
        .filter(r => r !== run && ((0, time_1.parseIso)(r.date)?.getTime() ?? 0) < t)
        .sort((x, y) => ((0, time_1.parseIso)(y.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(x.date)?.getTime() ?? 0));
    return earlier.find(r => (r.task || '').toLowerCase() === (run.task || '').toLowerCase()) ?? null;
}
/** Find a run by its id, or by task+date when the reporter predates run ids. */
function findRun(history, key) {
    return history.find(r => r.runId === key) ?? history.find(r => `${r.task}|${r.date}` === key) ?? null;
}
/** The stable key a UI should send back for a run. */
function runKey(r) {
    return r.runId || `${r.task}|${r.date}`;
}
function messages(r) {
    return (r.warningItems ?? []).map(w => (w?.msg ?? '').trim()).filter(Boolean);
}
//# sourceMappingURL=compare.js.map