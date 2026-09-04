"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.summaryFacts = summaryFacts;
exports.dailySummaryText = dailySummaryText;
exports.weeklyDigestText = weeklyDigestText;
exports.historyCsv = historyCsv;
const calendar_1 = require("./calendar");
const health_1 = require("./health");
const sparkline_1 = require("./sparkline");
const time_1 = require("./time");
const failures_1 = require("./failures");
function isToday(iso, now) {
    const d = (0, time_1.parseIso)(iso);
    return !!d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}
function summaryFacts(data, settings, now) {
    const states = data.tasks.map(t => (0, time_1.taskState)(t, settings.staleRunningMinutes, now, data.overlays));
    const today = data.history.filter(r => isToday(r.date, now));
    const rows = (0, calendar_1.calendarRows)(settings.processes, data.history, now);
    const overdue = rows.filter(r => r.status === 'overdue').map(r => r.process.label || r.process.name);
    // 'unseen' is excluded for the same reason it is not counted as overdue: nothing has ever
    // reported it, so it has no meaningful next-due date — its nominal one is usually already in
    // the past, which made the strip announce "next: X — overdue" while the calendar said
    // "not wired yet". Two views of one fact must never disagree. The past-due guard is belt and
    // braces: no other status can produce one, and if that ever changes this still cannot lie.
    const upcoming = rows
        .filter(r => r.status !== 'overdue' && r.status !== 'unseen' && r.nextDue.getTime() >= now.getTime())
        .sort((a, b) => a.nextDue.getTime() - b.nextDue.getTime())[0];
    const health = settings.sections.scriptHealth ? (0, health_1.healthRows)(data.history, settings.staleHours, now, 0) : [];
    const metricsOutOfRange = [];
    for (const [name, t] of Object.entries(settings.deltas.thresholds || {})) {
        const pts = data.deltas[name];
        if (!pts || !pts.length)
            continue;
        if ((0, sparkline_1.outOfRange)(pts[pts.length - 1].value, t))
            metricsOutOfRange.push(name);
    }
    const lastRun = data.history.slice().sort((a, b) => ((0, time_1.parseIso)(b.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.date)?.getTime() ?? 0))[0] ?? null;
    return {
        runningCount: states.filter(s => s === 'running').length,
        stalledCount: states.filter(s => s === 'stalled' || s === 'exited').length,
        runsToday: today.length,
        failedToday: today.filter(r => !r.success).length,
        warningsToday: today.reduce((n, r) => n + (r.warnings || 0), 0),
        overdue,
        nextDue: upcoming ? { label: upcoming.process.label || upcoming.process.name, text: (0, calendar_1.dueText)(upcoming.nextDue, now) } : null,
        staleScripts: health.filter(h => h.freshness === 'stale').map(h => h.task),
        metricsOutOfRange,
        lastRun,
    };
}
/** Plain text for a standup / status message. */
function dailySummaryText(data, settings, now) {
    const f = summaryFacts(data, settings, now);
    const p = (n) => String(n).padStart(2, '0');
    const lines = [];
    lines.push(`Script Progress — ${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`);
    lines.push('');
    lines.push(`Runs today: ${f.runsToday} (${f.failedToday} failed, ${f.warningsToday} warnings)`);
    if (f.runningCount)
        lines.push(`Running now: ${f.runningCount}`);
    if (f.stalledCount)
        lines.push(`Stalled / exited: ${f.stalledCount}`);
    const today = data.history
        .filter(r => isToday(r.date, now))
        .sort((a, b) => ((0, time_1.parseIso)(a.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(b.date)?.getTime() ?? 0));
    for (const r of today) {
        const d = (0, time_1.parseIso)(r.date);
        const t = d ? `${p(d.getHours())}:${p(d.getMinutes())}` : '';
        const metrics = r.metrics ? Object.entries(r.metrics).map(([k, v]) => `${k}=${typeof v === 'number' ? (0, sparkline_1.formatMetric)(v) : v}`).join(', ') : '';
        lines.push(`  ${r.success ? 'OK  ' : 'FAIL'} ${t} ${r.task} · ${(0, time_1.formatDuration)(r.elapsed)}${r.warnings ? ` · ${r.warnings} warning(s)` : ''}${r.summary ? ` · ${r.summary}` : ''}${metrics ? ` · ${metrics}` : ''}`);
    }
    if (settings.processes.length) {
        lines.push('');
        lines.push(`Calendar: ${f.overdue.length ? 'OVERDUE ' + f.overdue.join(', ') : 'nothing overdue'}${f.nextDue ? ` · next: ${f.nextDue.label} ${f.nextDue.text}` : ''}`);
    }
    if (f.staleScripts.length)
        lines.push(`Stale scripts: ${f.staleScripts.join(', ')}`);
    if (f.metricsOutOfRange.length)
        lines.push(`Metrics out of range: ${f.metricsOutOfRange.join(', ')}`);
    return lines.join('\n');
}
/**
 * A week's worth, for the kind of status note that goes to someone who was not watching.
 * Same shape as the daily summary, rolled up: what ran, what did not, what is overdue, how the
 * tracked metrics moved, and the failure pattern if there is one.
 */
const NL = '\n';
function weeklyDigestText(data, settings, now, days = 7) {
    const p = (n) => String(n).padStart(2, '0');
    const day = (d) => `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1));
    const runs = data.history
        .filter(r => { const d = (0, time_1.parseIso)(r.date); return !!d && d >= from; })
        .sort((a, b) => ((0, time_1.parseIso)(a.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(b.date)?.getTime() ?? 0));
    const lines = [];
    lines.push(`Script Progress — week of ${day(from)} to ${day(now)}`);
    lines.push('');
    const failed = runs.filter(r => !r.success);
    const warnings = runs.reduce((n, r) => n + (r.warnings || 0), 0);
    lines.push(`${runs.length} run(s) · ${failed.length} failed · ${warnings} warning(s)`);
    lines.push('');
    // Per task: how often, how it went, how long it typically took.
    const byTask = new Map();
    for (const r of runs) {
        const list = byTask.get(r.task);
        if (list)
            list.push(r);
        else
            byTask.set(r.task, [r]);
    }
    if (byTask.size) {
        lines.push('By script:');
        for (const [task, list] of Array.from(byTask.entries()).sort((a, b) => b[1].length - a[1].length)) {
            const bad = list.filter(r => !r.success).length;
            const avg = list.reduce((n, r) => n + (Number(r.elapsed) || 0), 0) / list.length;
            const warn = list.reduce((n, r) => n + (r.warnings || 0), 0);
            lines.push(`  ${task}: ${list.length} run(s)${bad ? `, ${bad} FAILED` : ''}${warn ? `, ${warn} warning(s)` : ''} · typically ${(0, time_1.formatDuration)(avg)}`);
        }
        lines.push('');
    }
    // Scripts the calendar expected but never saw this week.
    const rows = (0, calendar_1.calendarRows)(settings.processes, data.history, now);
    const overdue = rows.filter(r => r.status === 'overdue');
    const partial = rows.filter(r => r.status === 'partial');
    const unseen = rows.filter(r => r.status === 'unseen');
    if (settings.processes.length) {
        lines.push(`Calendar: ${overdue.length ? 'OVERDUE ' + overdue.map(r => r.process.label || r.process.name).join(', ') : 'nothing overdue'}`);
        for (const r of partial)
            lines.push(`  ${r.process.label || r.process.name}: ${r.note}`);
        if (unseen.length)
            lines.push(`  not wired yet: ${unseen.map(r => r.process.label || r.process.name).join(', ')}`);
        lines.push('');
    }
    // How the tracked numbers moved across the week.
    const moved = [];
    for (const name of settings.deltaMetrics) {
        const pts = (data.deltas[name] ?? []).filter(pt => { const d = (0, time_1.parseIso)(pt.date); return !!d && d >= from; });
        if (pts.length < 1)
            continue;
        const fmt = settings.deltas.formats?.[name];
        const first = pts[0].value, last = pts[pts.length - 1].value;
        const arrow = last > first ? 'up' : last < first ? 'down' : 'flat';
        moved.push(`  ${fmt?.label || name}: ${(0, sparkline_1.formatMetric)(first, fmt)} -> ${(0, sparkline_1.formatMetric)(last, fmt)} (${arrow})`);
    }
    if (moved.length) {
        lines.push('Tracked metrics:');
        lines.push(...moved);
        lines.push('');
    }
    if (failed.length) {
        lines.push('Failures:');
        for (const r of failed) {
            const d = (0, time_1.parseIso)(r.date);
            lines.push(`  ${d ? day(d) : ''} ${r.task}${r.category ? ` [${r.category}]` : ''}${r.summary ? ` — ${r.summary}` : ''}`);
        }
        const pattern = (0, failures_1.patternText)((0, failures_1.failurePatterns)(data.history, now, days, 20));
        if (pattern)
            lines.push(`  Pattern: ${pattern}`);
        lines.push('');
    }
    const f = summaryFacts(data, settings, now);
    if (f.staleScripts.length)
        lines.push(`Stale scripts: ${f.staleScripts.join(', ')}`);
    if (f.metricsOutOfRange.length)
        lines.push(`Metrics out of range: ${f.metricsOutOfRange.join(', ')}`);
    return lines.join(NL).replace(new RegExp(`${NL}{3,}`, 'g'), NL + NL).trimEnd();
}
/** CSV of run history (RFC 4180 quoting). */
function historyCsv(history) {
    const q = (v) => {
        let s = v === undefined || v === null ? '' : String(v);
        // A leading = + - @ (or tab/CR) would be executed as a formula by spreadsheets; neutralise it.
        if (/^[=+\-@\t\r]/.test(s) && !(typeof v === 'number'))
            s = `'${s}`;
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = history
        .slice()
        .sort((a, b) => ((0, time_1.parseIso)(a.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(b.date)?.getTime() ?? 0));
    const metricKeys = Array.from(new Set(rows.flatMap(r => Object.keys(r.metrics || {})))).sort();
    const head = ['date', 'task', 'success', 'elapsed_seconds', 'warnings', 'summary', 'run_id', 'started_at', ...metricKeys];
    const out = [head.join(',')];
    for (const r of rows) {
        out.push([
            r.date, r.task, r.success ? 'true' : 'false', r.elapsed, r.warnings ?? 0, r.summary ?? '', r.runId ?? '', r.startedAt ?? '',
            ...metricKeys.map(k => (r.metrics && k in r.metrics ? r.metrics[k] : '')),
        ].map(q).join(','));
    }
    return out.join('\r\n') + '\r\n';
}
//# sourceMappingURL=summary.js.map