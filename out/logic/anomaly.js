"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.durationVerdict = durationVerdict;
exports.slaFor = slaFor;
exports.overSla = overSla;
exports.metricChanges = metricChanges;
exports.previousRun = previousRun;
exports.metricAnomalies = metricAnomalies;
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
/**
 * Metrics in `run` that are far from their own median across this task's previous runs.
 *
 * Duration anomalies catch infrastructure; THESE catch data. A row count that falls from 3,990
 * to 200, or an issue count that jumps from 311 to 500, is the kind of thing that never fails a
 * run and is exactly what someone needed to know.
 *
 * Requires at least `minSample` prior successful runs, because two data points have no
 * meaningful median and a detector that fires on thin evidence is one that gets switched off.
 * `ignore` holds metric names that are expected to vary (a timestamp, an id, a naturally noisy
 * count) — without it, one restless number trains the reader to ignore all of them.
 */
function metricAnomalies(run, history, factor = 2, ignore = [], minSample = 4) {
    const metrics = run.metrics;
    if (!metrics)
        return [];
    const skip = new Set(ignore.map(s => s.toLowerCase()));
    const t = (0, time_1.parseIso)(run.date)?.getTime() ?? 0;
    const prior = history.filter(r => r !== run && r.task === run.task && r.success && ((0, time_1.parseIso)(r.date)?.getTime() ?? 0) < t);
    const out = [];
    for (const [key, raw] of Object.entries(metrics)) {
        if (skip.has(key.toLowerCase()) || typeof raw !== 'number' || !isFinite(raw))
            continue;
        const series = prior
            .map(r => r.metrics?.[key])
            .filter((v) => typeof v === 'number' && isFinite(v))
            .slice(-20);
        if (series.length < minSample)
            continue;
        const baseline = median(series);
        // A baseline of zero has no ratio. Only a move AWAY from zero is notable; staying at zero is
        // the most normal thing a zero-valued metric can do.
        if (baseline === 0) {
            if (raw !== 0)
                out.push({ key, value: raw, baseline, factor: 0, direction: 'up', sample: series.length });
            continue;
        }
        const f = raw / baseline;
        if (f >= factor)
            out.push({ key, value: raw, baseline, factor: f, direction: 'up', sample: series.length });
        else if (f > 0 && f <= 1 / factor)
            out.push({ key, value: raw, baseline, factor: f, direction: 'down', sample: series.length });
        else if (f <= 0 && baseline > 0)
            out.push({ key, value: raw, baseline, factor: f, direction: 'down', sample: series.length });
    }
    return out;
}
//# sourceMappingURL=anomaly.js.map