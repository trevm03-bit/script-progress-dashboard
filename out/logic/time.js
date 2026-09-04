"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDuration = formatDuration;
exports.parseIso = parseIso;
exports.relativeTime = relativeTime;
exports.clockTime = clockTime;
exports.dateTime = dateTime;
exports.deriveStart = deriveStart;
exports.liveElapsed = liveElapsed;
exports.liveEta = liveEta;
exports.minutesSinceUpdate = minutesSinceUpdate;
exports.taskMatches = taskMatches;
exports.sameTask = sameTask;
exports.exitOverlayFor = exitOverlayFor;
exports.taskState = taskState;
exports.percent = percent;
exports.slug = slug;
/** 45 -> "45s", 125 -> "2m5s", 3600 -> "1h", 7261 -> "2h1m". */
function formatDuration(seconds) {
    if (!isFinite(seconds) || seconds < 0)
        seconds = 0;
    // Round ONCE, to whole seconds, and do the rest of the maths on that. Rounding each part
    // separately printed durations that cannot exist: 59.6 came out as "60s", 119.6 as "1m60s" and
    // 3599.6 as "59m60s". Both reporters write elapsed to one decimal place, and every average and
    // median in the product divides, so fractional seconds are the normal case, not an edge one.
    const total = Math.round(seconds);
    if (total < 60)
        return `${total}s`;
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0)
        return m > 0 ? `${h}h${m}m` : `${h}h`;
    return s > 0 ? `${m}m${s}s` : `${m}m`;
}
/** Parse an ISO timestamp; null when missing or unparseable (never throws). */
function parseIso(value) {
    if (!value)
        return null;
    const d = new Date(value);
    return isNaN(d.getTime()) ? null : d;
}
/** "just now", "5m ago", "2h ago", "3d ago", "6w ago". */
function relativeTime(iso, now) {
    const d = parseIso(iso);
    if (!d)
        return 'never';
    const sec = Math.max(0, (now.getTime() - d.getTime()) / 1000);
    if (sec < 45)
        return 'just now';
    const min = sec / 60;
    if (min < 60)
        return `${Math.round(min)}m ago`;
    const hr = min / 60;
    if (hr < 24)
        return `${Math.round(hr)}h ago`;
    const day = hr / 24;
    if (day < 14)
        return `${Math.round(day)}d ago`;
    return `${Math.round(day / 7)}w ago`;
}
/** Local clock time "14:02". */
function clockTime(iso) {
    const d = parseIso(iso);
    if (!d)
        return '';
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
/** Local date + time "2026-09-02 14:02". */
function dateTime(iso) {
    const d = parseIso(iso);
    if (!d)
        return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
/**
 * The script's start time: startedAt when the reporter gave it, else derived from the last
 * write (updatedAt minus the elapsed seconds it reported). Lets elapsed tick live between writes.
 */
function deriveStart(progress) {
    const started = parseIso(progress.startedAt);
    if (started)
        return started;
    const updated = parseIso(progress.updatedAt);
    if (!updated)
        return null;
    return new Date(updated.getTime() - (progress.elapsed || 0) * 1000);
}
/** Seconds elapsed as of `now` while running; the reported figure once finished. */
function liveElapsed(progress, now) {
    if (progress.status !== 'running')
        return progress.elapsed || 0;
    const start = deriveStart(progress);
    if (!start)
        return progress.elapsed || 0;
    return Math.max(0, (now.getTime() - start.getTime()) / 1000);
}
/** Live ETA: the reported ETA shrinks as time passes since the write. */
function liveEta(progress, now) {
    if (progress.status !== 'running' || progress.eta === null || progress.eta === undefined)
        return null;
    const updated = parseIso(progress.updatedAt);
    if (!updated)
        return progress.eta;
    const since = (now.getTime() - updated.getTime()) / 1000;
    return Math.max(0, progress.eta - since);
}
/** Minutes since the file was last written. */
function minutesSinceUpdate(progress, now) {
    const updated = parseIso(progress.updatedAt);
    if (!updated)
        return Infinity;
    return (now.getTime() - updated.getTime()) / 60000;
}
/** The one task-name match used everywhere: the run's task name starts with the configured name. */
function taskMatches(runTask, configured) {
    if (!configured)
        return false;
    return (runTask || '').toLowerCase().startsWith(configured.toLowerCase());
}
/** The whole task name, case-insensitively. Used where a PREFIX would over-match — see below. */
function sameTask(a, b) {
    return (a || '').toLowerCase() === (b || '').toLowerCase();
}
/**
 * Does a process-exit overlay apply to this run?
 *
 * 🔴 EXACT names only, and the most RECENT matching exit wins.
 *
 * Prefix matching is right for a button pointing at a family of scripts, and wrong here. A button
 * configured with task "Nightly" once attached its single exit to every running script whose name
 * began with "Nightly" — so one process ending marked two healthy scripts as crashed, each with a
 * false error toast and a bogus event written to disk. The extension resolves the overlay to the
 * one running task it belongs to before storing it (see extension.ts), so by the time it gets
 * here the name is already the real one; anything less than an exact match is over-reach.
 */
function exitOverlayFor(progress, overlays) {
    if (!overlays || !overlays.length)
        return null;
    const start = deriveStart(progress)?.getTime() ?? 0;
    let best = null;
    let bestWhen = -Infinity;
    for (const o of overlays) {
        if (!sameTask(progress.task, o.task))
            continue;
        const when = parseIso(o.when)?.getTime() ?? 0;
        if (when >= start - 1000 && when >= bestWhen) {
            best = o;
            bestWhen = when;
        }
    }
    return best;
}
/**
 * The state shown to the user. A 'running' file that has not been touched for
 * staleRunningMinutes almost always means the script died without calling complete().
 */
function taskState(progress, staleRunningMinutes, now, overlays) {
    if (!progress)
        return 'idle';
    if (progress.status === 'complete')
        return 'complete';
    if (progress.status === 'failed')
        return 'failed';
    if (exitOverlayFor(progress, overlays))
        return 'exited';
    return minutesSinceUpdate(progress, now) > staleRunningMinutes ? 'stalled' : 'running';
}
/** 0..100, safe for total = 0. Includes the fraction inside the current step when the reporter gave one. */
function percent(step, total, substep) {
    if (!total || total <= 0)
        return 0;
    // Without a substep the current step counts as done (the spec's behaviour). With one, the bar
    // sits inside the current step and never moves backwards: step-1 done steps plus the fraction,
    // but never below what "no substep" would show for the previous step.
    const hasSub = typeof substep === 'number' && isFinite(substep);
    const value = hasSub
        ? ((Math.max(0, step - 1) + Math.max(0, Math.min(1, substep))) / total) * 100
        : (step / total) * 100;
    return Math.max(0, Math.min(100, Math.round(value)));
}
/** A URL-safe slug the reporters use for per-task files: "Nightly Load 2" -> "nightly-load-2". */
function slug(name) {
    return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'task';
}
//# sourceMappingURL=time.js.map