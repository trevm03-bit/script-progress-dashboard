"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.durationVerdict = durationVerdict;
exports.slaFor = slaFor;
exports.overSla = overSla;
exports.metricChanges = metricChanges;
exports.previousRun = previousRun;
const calendar_1 = require("./calendar");
const time_1 = require("./time");
function median(values) {
    const v = values.slice().sort((a, b) => a - b);
    if (!v.length)
        return 0;
    const m = Math.floor(v.length / 2);
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
/**
 * Compare one run's duration with the median of the task's other successful runs before it.
 * Needs at least 3 prior runs to say anything; below that factor = 1 and slow = false.
 */
function durationVerdict(run, history, factor = 2) {
    const t = (0, time_1.parseIso)(run.date)?.getTime() ?? 0;
    const prior = history
        .filter(r => r !== run && r.task === run.task && r.success && typeof r.elapsed === 'number' && ((0, time_1.parseIso)(r.date)?.getTime() ?? 0) < t)
        .map(r => r.elapsed)
        .slice(-20);
    if (prior.length < 3 || !(run.elapsed > 0))
        return { factor: 1, baseline: median(prior), sample: prior.length, slow: false };
    const baseline = median(prior);
    const f = baseline > 0 ? run.elapsed / baseline : 1;
    return { factor: f, baseline, sample: prior.length, slow: f >= factor && run.elapsed - baseline >= 5 };
}
/** The SLA (maxMinutes) that applies to a task, from the first matching process. */
function slaFor(task, processes) {
    const p = processes.find(x => typeof x.maxMinutes === 'number' && x.maxMinutes > 0 && (0, calendar_1.matchesProcess)(task, x));
    return p?.maxMinutes;
}
/** true when a run (or a running task's live elapsed) exceeds its SLA. */
function overSla(task, elapsedSeconds, processes) {
    const max = slaFor(task, processes);
    return typeof max === 'number' && elapsedSeconds > max * 60;
}
function metricChanges(run, previous) {
    const out = [];
    for (const [key, value] of Object.entries(run.metrics || {})) {
        const prev = previous?.metrics?.[key];
        let delta = null;
        let pct = null;
        if (typeof value === 'number' && typeof prev === 'number' && isFinite(value) && isFinite(prev)) {
            delta = value - prev;
            pct = prev !== 0 ? (delta / Math.abs(prev)) * 100 : null;
        }
        out.push({ key, value, previous: prev, delta, pct });
    }
    return out;
}
/** The previous run of the same task before this one, if any. */
function previousRun(run, history) {
    const t = (0, time_1.parseIso)(run.date)?.getTime() ?? 0;
    return history
        .filter(r => r !== run && r.task === run.task && ((0, time_1.parseIso)(r.date)?.getTime() ?? 0) < t)
        .sort((a, b) => ((0, time_1.parseIso)(b.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.date)?.getTime() ?? 0))[0];
}
//# sourceMappingURL=anomaly.js.map