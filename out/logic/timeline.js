"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tickStepHours = tickStepHours;
exports.windowHoursOf = windowHoursOf;
exports.timelineTicks = timelineTicks;
exports.timelineModel = timelineModel;
const anomaly_1 = require("./anomaly");
const time_1 = require("./time");
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Hour ticks for a short window, 6-hourly up to a week, daily beyond. */
function tickStepHours(windowHours) {
    if (windowHours <= 48)
        return 1;
    if (windowHours <= 24 * 7)
        return 6;
    return 24;
}
/** The configured window in hours, defaulted and sanity-clamped (1 minute .. 1 year). */
function windowHoursOf(settings) {
    const h = settings.timeline?.windowHours;
    if (typeof h !== 'number' || !isFinite(h) || h <= 0)
        return 24;
    return Math.min(24 * 365, Math.max(1 / 60, h));
}
function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
}
function pad(n) {
    return String(n).padStart(2, '0');
}
/** "2 Sep" for day boundaries, "14:00" otherwise. */
function tickLabel(at, stepHours) {
    if (stepHours >= 24 || at.getHours() === 0)
        return `${at.getDate()} ${MONTHS[at.getMonth()]}`;
    return `${pad(at.getHours())}:00`;
}
/** Which ticks get a label, so 24 hour-lines do not become 24 overlapping words. */
function labelled(at, stepHours, windowHours) {
    if (stepHours >= 24)
        return true;
    if (stepHours === 6)
        return windowHours > 96 ? at.getHours() % 12 === 0 : true;
    return windowHours > 12 ? at.getHours() % 3 === 0 : true;
}
/**
 * Tick marks on local-time boundaries inside the window. Built by adding hour offsets to a local
 * midnight (not by adding milliseconds) so a DST change does not skew the grid.
 */
function timelineTicks(start, end, windowHours) {
    const step = tickStepHours(windowHours);
    const span = end.getTime() - start.getTime();
    if (!(span > 0))
        return [];
    const base = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0);
    const out = [];
    for (let i = 0; i < 4000; i++) {
        const at = new Date(base.getFullYear(), base.getMonth(), base.getDate(), i * step, 0, 0, 0);
        const t = at.getTime();
        if (t > end.getTime())
            break;
        if (t < start.getTime())
            continue;
        out.push({
            at,
            x: clamp01((t - start.getTime()) / span),
            label: labelled(at, step, windowHours) ? tickLabel(at, step) : '',
            major: at.getHours() === 0,
        });
    }
    return out;
}
function makeBar(name, start, end, opts, w0, w1) {
    const s = Math.min(start.getTime(), end.getTime());
    const e = Math.max(start.getTime(), end.getTime());
    const span = w1 - w0;
    return {
        start: new Date(s),
        end: new Date(e),
        success: opts.success,
        running: opts.running,
        slow: opts.slow,
        overSla: opts.overSla,
        run: opts.run,
        task: opts.task,
        name,
        seconds: (e - s) / 1000,
        x0: clamp01((s - w0) / span),
        x1: clamp01((e - w0) / span),
        clippedStart: s < w0,
        clippedEnd: e > w1,
    };
}
/** Inside the window? Zero-length runs count when they sit on it; others need real overlap. */
function inWindow(start, end, w0, w1) {
    if (start === end)
        return start >= w0 && start <= w1;
    return end > w0 && start < w1;
}
function timelineModel(data, settings, now) {
    const windowHours = windowHoursOf(settings);
    // 🔴 Quantise the right edge to the minute. Tick and bar positions are printed to two or three
    // decimal places, so an unrounded "now" made this the ONE section whose HTML differed on every
    // render - which defeated the dashboard's "only post when something changed" gate entirely, and
    // rebuilt the Access Map card (canvas, legend and a setState write) once a second for ever.
    // A minute of lag on a window measured in hours is not visible; the live detail is in Active
    // Task, which does tick every second.
    const w1 = Math.floor(now.getTime() / 60000) * 60000;
    const w0 = w1 - windowHours * 3600 * 1000;
    const start = new Date(w0);
    const end = new Date(w1);
    const showFailed = settings.timeline?.showFailed !== false;
    const anomalies = settings.runHistory?.anomalies === true;
    const factor = typeof settings.runHistory?.anomalyFactor === 'number' ? settings.runHistory.anomalyFactor : 2;
    const processes = settings.processes || [];
    const history = data.history || [];
    const bars = [];
    const seenRunIds = new Set();
    for (const run of history) {
        if (!run || (!run.success && !showFailed))
            continue;
        const endAt = (0, time_1.parseIso)(run.date);
        if (!endAt)
            continue;
        const startedAt = (0, time_1.parseIso)(run.startedAt);
        const elapsed = typeof run.elapsed === 'number' && isFinite(run.elapsed) && run.elapsed > 0 ? run.elapsed : 0;
        const startAt = startedAt && startedAt.getTime() <= endAt.getTime()
            ? startedAt
            : new Date(endAt.getTime() - elapsed * 1000);
        if (!inWindow(startAt.getTime(), endAt.getTime(), w0, w1))
            continue;
        if (run.runId)
            seenRunIds.add(run.runId);
        bars.push(makeBar(run.task || '', startAt, endAt, {
            success: !!run.success,
            running: false,
            slow: anomalies ? (0, anomaly_1.durationVerdict)(run, history, factor).slow : false,
            overSla: (0, anomaly_1.overSla)(run.task || '', run.elapsed || 0, processes),
            run,
        }, w0, w1));
    }
    for (const task of data.tasks || []) {
        if (!task || task.status !== 'running')
            continue;
        if (task.runId && seenRunIds.has(task.runId))
            continue; // history already has this run finished
        const elapsed = (0, time_1.liveElapsed)(task, now);
        const startAt = (0, time_1.deriveStart)(task) ?? new Date(w1 - elapsed * 1000);
        if (!inWindow(startAt.getTime(), w1, w0, w1))
            continue;
        // The TRUE end is `now`, so the tooltip reports the real live elapsed. Drawing past the
        // quantised right edge is already handled: makeBar clamps x1 to 1 and sets clippedEnd.
        bars.push(makeBar(task.task || '', startAt, now, {
            success: true,
            running: true,
            slow: false,
            overSla: (0, anomaly_1.overSla)(task.task || '', elapsed, processes),
            task,
        }, w0, w1));
    }
    const byTask = new Map();
    for (const b of bars) {
        const list = byTask.get(b.name);
        if (list)
            list.push(b);
        else
            byTask.set(b.name, [b]);
    }
    const span = w1 - w0;
    const lanes = [];
    for (const [task, list] of byTask) {
        list.sort((a, b) => a.start.getTime() - b.start.getTime());
        let failures = 0;
        let totalSeconds = 0;
        let windowSeconds = 0;
        let busiest = null;
        let lastActivity = 0;
        for (const b of list) {
            if (!b.success && !b.running)
                failures++;
            totalSeconds += b.seconds;
            windowSeconds += ((b.x1 - b.x0) * span) / 1000;
            if (!busiest || b.seconds > busiest.seconds)
                busiest = b;
            lastActivity = Math.max(lastActivity, b.end.getTime());
        }
        lanes.push({
            task,
            bars: list,
            runs: list.length,
            failures,
            totalSeconds,
            windowSeconds,
            busiest,
            lastActivity: new Date(lastActivity),
            running: list.some(b => b.running),
        });
    }
    lanes.sort((a, b) => (b.lastActivity.getTime() - a.lastActivity.getTime()) || a.task.localeCompare(b.task));
    return {
        start,
        end,
        windowHours,
        stepHours: tickStepHours(windowHours),
        lanes,
        ticks: timelineTicks(start, end, windowHours),
        runs: bars.length,
        failures: bars.filter(b => !b.success && !b.running).length,
        running: bars.filter(b => b.running).length,
    };
}
//# sourceMappingURL=timeline.js.map