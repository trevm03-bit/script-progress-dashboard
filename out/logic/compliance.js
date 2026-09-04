"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_COVERAGE_WEIGHTS = void 0;
exports.complianceReport = complianceReport;
exports.impactTotals = impactTotals;
exports.pendingActions = pendingActions;
exports.coverage = coverage;
const calendar_1 = require("./calendar");
const time_1 = require("./time");
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/**
 * Did this process run in each of the last `count` periods?
 *
 * The current period is excluded: it is not over, so counting it as missed would drag every
 * figure down for reasons that are not yet true. Periods before the process ever ran are marked
 * `known: false` and left out of the percentage — a process wired up last week is not "0% for
 * the year", it simply has no history, and pretending otherwise makes the number useless.
 */
function complianceReport(process, history, now, count = 12) {
    const runs = history
        .filter(r => (0, calendar_1.matchesProcess)(r.task, process) && r.success)
        .map(r => ({ r, d: (0, time_1.parseIso)(r.date) }))
        .filter((x) => !!x.d)
        .sort((a, b) => a.d.getTime() - b.d.getTime());
    const firstEver = runs[0]?.d ?? null;
    const periods = [];
    for (let i = count; i >= 1; i--) {
        const { start, end, label } = periodBounds(process, now, i);
        const inPeriod = runs.filter(x => x.d >= start && x.d < end);
        periods.push({
            label, start, end,
            met: inPeriod.length > 0,
            known: !!firstEver && firstEver < end,
            runs: inPeriod.length,
        });
    }
    const judged = periods.filter(p => p.known);
    const met = judged.filter(p => p.met).length;
    let streak = 0;
    for (let i = periods.length - 1; i >= 0; i--) {
        if (!periods[i].known)
            break;
        if (!periods[i].met)
            break;
        streak++;
    }
    return {
        process, periods,
        met, of: judged.length,
        percent: judged.length ? Math.round((met / judged.length) * 100) : null,
        streak,
    };
}
/** Start/end of the period `back` steps before the current one (1 = the last complete period). */
function periodBounds(process, now, back) {
    const y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
    switch (process.frequency) {
        case 'daily': {
            const start = new Date(y, m, d - back);
            const end = new Date(y, m, d - back + 1);
            return { start, end, label: `${start.getDate()} ${MONTHS[start.getMonth()]}` };
        }
        case 'weekly': {
            const monday = startOfWeek(now);
            const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7 * back);
            const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
            return { start, end, label: `wk ${start.getDate()} ${MONTHS[start.getMonth()]}` };
        }
        case 'monthly':
        default: {
            const start = new Date(y, m - back, 1);
            const end = new Date(y, m - back + 1, 1);
            return { start, end, label: `${MONTHS[start.getMonth()]} ${String(start.getFullYear()).slice(2)}` };
        }
    }
}
function startOfWeek(d) {
    const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = out.getDay();
    out.setDate(out.getDate() - (day === 0 ? 6 : day - 1));
    return out;
}
/**
 * Sum what runs have contributed, per metric. Newest activity first.
 *
 * `history` is optional but should always be passed: `impact()` writes the moment it is called,
 * so a run that crashes afterwards has still contributed to the file. Counting it would let a
 * failed run inflate the headline — the same mistake Pending Actions deliberately avoids.
 */
function impactTotals(impact, now, history = []) {
    const out = [];
    const failedRuns = new Set(history.filter(r => !r.success && r.runId).map(r => r.runId));
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    for (const [metric, points] of Object.entries(impact || {})) {
        if (!Array.isArray(points) || !points.length)
            continue;
        const valid = points.filter(p => p && typeof p.value === 'number' && isFinite(p.value) && !(p.runId && failedRuns.has(p.runId)));
        if (!valid.length)
            continue;
        const runIds = new Set(valid.map(p => p.runId ?? p.date));
        out.push({
            metric,
            label: valid.find(p => p.label)?.label || metric,
            total: round(valid.reduce((n, p) => n + p.value, 0)),
            runs: runIds.size,
            first: valid[0].date,
            last: valid[valid.length - 1].date,
            thisMonth: round(valid.filter(p => { const d = (0, time_1.parseIso)(p.date); return !!d && d >= monthStart; }).reduce((n, p) => n + p.value, 0)),
        });
    }
    return out.sort((a, b) => ((0, time_1.parseIso)(b.last)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.last)?.getTime() ?? 0));
}
/**
 * Warnings a script marked `actionable`, from each task's most recent SUCCESSFUL run.
 *
 * Derived, never stored — which is the whole point. An item disappears exactly when a later
 * successful run of that task stops reporting it, and no earlier. 🔴 A run that FAILED cannot
 * clear anything: it may have died before reaching the check, and treating "did not mention it"
 * as "dealt with" would quietly retire real findings. Absence of evidence, in a run that
 * crashed, is not evidence of absence.
 */
function pendingActions(history, now, maxAgeDays = 90) {
    const cutoff = now.getTime() - maxAgeDays * 86400000;
    const latestSuccessByTask = new Map();
    for (const r of history) {
        if (!r.success)
            continue;
        const d = (0, time_1.parseIso)(r.date)?.getTime() ?? 0;
        if (d < cutoff)
            continue;
        const cur = latestSuccessByTask.get(r.task);
        // >= not >: timestamps are second-resolution, so two runs of one task can share one. History
        // is append-ordered oldest-first, so on a tie the later entry is the newer run — and picking
        // the older one would leave an item outstanding that the newer run had already cleared.
        if (!cur || d >= ((0, time_1.parseIso)(cur.date)?.getTime() ?? 0))
            latestSuccessByTask.set(r.task, r);
    }
    const out = [];
    for (const [task, run] of latestSuccessByTask) {
        // isRun() only guarantees task and date are strings; every other field comes from a file
        // any process can write. A renderer that throws blanks the dashboard, and this section is
        // on by default, so the guard belongs here rather than in the caller.
        if (!Array.isArray(run.warningItems))
            continue;
        for (const w of run.warningItems) {
            if (!w || typeof w !== 'object' || !w.actionable)
                continue;
            out.push({ ...w, task, runId: run.runId, date: run.date });
        }
    }
    return out.sort((a, b) => ((0, time_1.parseIso)(b.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.date)?.getTime() ?? 0));
}
exports.DEFAULT_COVERAGE_WEIGHTS = { schedule: 2, success: 2, metrics: 1 };
function coverage(calendar, history, metricsOutOfRange, metricsTracked, now, days = 30, weights = exports.DEFAULT_COVERAGE_WEIGHTS, historyCap = 0) {
    const inputs = [];
    const cutoff = now.getTime() - days * 86400000;
    // Upper bound as well as lower: a run dated years out is not evidence about the last 30 days.
    const recent = history.filter(r => {
        const t = (0, time_1.parseIso)(r.date)?.getTime() ?? 0;
        return t >= cutoff && t <= now.getTime();
    });
    // 1. Schedule adherence. 'blocked' and 'unseen' are excluded — neither is this process failing
    //    to comply. 🔴 'pending' is excluded too, and that matters: it means "not run and NOT YET
    //    DUE", so counting it as on time made every monthly process score full marks on the 1st and
    //    the figure was highest exactly when the tool knew least. 'partial' scores the fraction of
    //    its phases that are done, because that is what it is.
    const judged = calendar.filter(r => r.status !== 'unseen' && r.status !== 'blocked' && r.status !== 'pending');
    if (judged.length) {
        const score = judged.reduce((n, r) => {
            if (r.status === 'done')
                return n + 1;
            if (r.status === 'partial' && r.phases?.length)
                return n + r.phases.filter(p => p.done).length / r.phases.length;
            return n;
        }, 0);
        const pending = calendar.filter(r => r.status === 'pending').length;
        inputs.push({
            label: 'On schedule', score: score / judged.length, weight: weights.schedule,
            detail: `${round1(score)}/${judged.length} due process(es) on schedule${pending ? ` · ${pending} not due yet` : ''}`,
        });
    }
    // 2. Did runs succeed?
    if (recent.length) {
        const ok = recent.filter(r => r.success).length;
        // History is capped, so past that cap the denominator is the cap and not the window. Say so
        // rather than claiming a window the data cannot cover.
        const capped = historyCap > 0 && history.length >= historyCap;
        inputs.push({
            label: 'Runs succeeded', score: ok / recent.length, weight: weights.success,
            // Say what the denominator ACTUALLY is. "5/7 of the last 100 runs" was arithmetic nonsense:
            // 7 is the window count, 100 is the file cap. When the file is full, the window is only as
            // deep as the file allows, so name that instead of inventing a third number.
            detail: capped
                ? `${ok}/${recent.length} run(s) in ${days} days (history is full at ${historyCap}, so older runs are not counted)`
                : `${ok}/${recent.length} run(s) in ${days} days`,
        });
    }
    // 3. Are the tracked numbers inside their thresholds?
    if (metricsTracked > 0) {
        inputs.push({
            label: 'Metrics in range', score: (metricsTracked - metricsOutOfRange) / metricsTracked, weight: weights.metrics,
            detail: `${metricsTracked - metricsOutOfRange}/${metricsTracked} metric(s) in range`,
        });
    }
    // 🔴 At least one OBSERVED input. With no runs and no due processes, the only surviving input
    // is "metrics in range", and a lone threshold would put a green 100% at the top of the page for
    // a routine that has never run — the figure at its most confident when it knows nothing.
    const observed = inputs.some(i => i.label === 'On schedule' || i.label === 'Runs succeeded');
    if (!inputs.length || !observed)
        return { percent: null, inputs };
    // Weights are user-settable and may all be zero. Dividing by that produced NaN, which passed
    // the caller's `!== null` guard and rendered as "NaN%".
    const total = inputs.reduce((n, i) => n + i.weight, 0);
    if (!(total > 0))
        return { percent: null, inputs };
    const score = inputs.reduce((n, i) => n + clamp01(i.score) * i.weight, 0) / total;
    return { percent: Number.isFinite(score) ? Math.round(score * 100) : null, inputs };
}
function clamp01(n) { return Math.max(0, Math.min(1, isFinite(n) ? n : 0)); }
function round1(n) { return Math.round(n * 10) / 10; }
function round(n) { return Math.round(n * 100) / 100; }
//# sourceMappingURL=compliance.js.map