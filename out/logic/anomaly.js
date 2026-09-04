"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.durationVerdict = durationVerdict;
exports.durationVerdicts = durationVerdicts;
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
    // 🔴 Sort before slicing. `slice(-20)` takes the LAST twenty of whatever order it is handed,
    // and this function is called with history both newest-first (the table) and oldest-first (the
    // notifier) — so the same run was measured against its twenty OLDEST runs on one surface and
    // its twenty most recent on the other. "The usual duration" means recent.
    const prior = history
        .filter(r => r !== run && r.task === run.task && r.success && typeof r.elapsed === 'number' && ((0, time_1.parseIso)(r.date)?.getTime() ?? 0) < t)
        .sort((a, b) => ((0, time_1.parseIso)(a.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(b.date)?.getTime() ?? 0))
        .map(r => r.elapsed)
        .slice(-20);
    if (prior.length < 3 || !(run.elapsed > 0))
        return { factor: 1, baseline: median(prior), sample: prior.length, slow: false };
    const baseline = median(prior);
    const f = baseline > 0 ? run.elapsed / baseline : 1;
    return { factor: f, baseline, sample: prior.length, slow: f >= factor && run.elapsed - baseline >= 5 };
}
/**
 * Every run's verdict in one pass, for callers that need the whole history judged at once.
 *
 * 🔴 Use this instead of calling `durationVerdict` in a loop. That function re-filters the ENTIRE
 * history per run, so judging n runs costs n² date parses — and the Run History header does
 * exactly that to count the "Slow" chip, once per second, forever. Measured before this existed:
 * 5,000 rows took 226 ms per render on a 1 Hz timer. Same maths, same twenty-run window, grouped
 * and sorted once.
 */
function durationVerdicts(history, factor = 2) {
    const out = new Map();
    const byTask = new Map();
    for (const r of history) {
        const list = byTask.get(r.task);
        const entry = { r, t: (0, time_1.parseIso)(r.date)?.getTime() ?? 0 };
        if (list)
            list.push(entry);
        else
            byTask.set(r.task, [entry]);
    }
    for (const list of byTask.values()) {
        list.sort((a, b) => a.t - b.t);
        const prior = [];
        let k = 0;
        for (const cur of list) {
            // Admit only runs STRICTLY earlier than this one, matching durationVerdict exactly — runs
            // sharing a timestamp must not measure each other.
            while (k < list.length && list[k].t < cur.t) {
                const c = list[k].r;
                if (c.success && typeof c.elapsed === 'number')
                    prior.push(c.elapsed);
                k++;
            }
            const window = prior.slice(-20);
            const baseline = median(window);
            if (window.length < 3 || !(cur.r.elapsed > 0)) {
                out.set(cur.r, { factor: 1, baseline, sample: window.length, slow: false });
            }
            else {
                const f = baseline > 0 ? cur.r.elapsed / baseline : 1;
                out.set(cur.r, { factor: f, baseline, sample: window.length, slow: f >= factor && cur.r.elapsed - baseline >= 5 });
            }
        }
    }
    return out;
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
            // A median of exactly 0 is what a symmetric oscillator looks like, so "anything non-zero"
            // would flag every run. Only report a move that is large relative to the series' own
            // spread — and if the series never moves at all, any movement is notable.
            if (raw !== 0) {
                const spread = median(series.map(v => Math.abs(v)));
                if (spread === 0 || Math.abs(raw) >= spread * factor) {
                    out.push({ key, value: raw, baseline, factor: 0, direction: 'up', sample: series.length });
                }
            }
            continue;
        }
        // 🔴 Compare MAGNITUDES, and read the direction from the values themselves. Dividing signed
        // numbers inverted everything for a negative baseline: a metric going from -100 to -1000 (ten
        // times worse) reported "down", and -100 to 0 (a collapse) was not reported at all, because
        // the ratio maths only ever made sense for positive medians. A variance, a net delta or a
        // balance change is naturally negative, and those are exactly the numbers worth watching.
        // Direction describes the MAGNITUDE, not the arithmetic value: for a metric whose usual
        // value is -100, landing at -1000 is a tenfold rise in the thing being measured, and calling
        // that "down" because -1000 < -100 tells the reader the opposite of what happened.
        const ratio = Math.abs(raw) / Math.abs(baseline);
        const direction = Math.abs(raw) >= Math.abs(baseline) ? 'up' : 'down';
        // A sign flip is only notable when the SIZE also moved. A net delta that swings between +5
        // and -4 every run flips constantly and is behaving exactly as expected; flagging it taught
        // the reader to ignore the flag.
        if (ratio >= factor || ratio <= 1 / factor) {
            out.push({ key, value: raw, baseline, factor: ratio, direction, sample: series.length });
        }
    }
    return out;
}
//# sourceMappingURL=anomaly.js.map