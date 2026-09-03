"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.matchesProcess = matchesProcess;
exports.runsFor = runsFor;
exports.startOfIsoWeek = startOfIsoWeek;
exports.processStatus = processStatus;
exports.calendarRows = calendarRows;
const time_1 = require("./time");
/** A run belongs to a process when its task name STARTS WITH the process name (case-insensitive). */
function matchesProcess(taskName, process) {
    if (!process.name)
        return false;
    return (taskName || '').toLowerCase().startsWith(process.name.toLowerCase());
}
/** Newest-first list of runs for a process. */
function runsFor(process, history) {
    return history
        .filter(r => matchesProcess(r.task, process))
        .sort((a, b) => ((0, time_1.parseIso)(b.date)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.date)?.getTime() ?? 0));
}
function sameLocalDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function sameLocalMonth(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}
/** Monday 00:00 local of the ISO week containing `d`. */
function startOfIsoWeek(d) {
    const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const day = out.getDay(); // 0 = Sunday
    const diff = day === 0 ? 6 : day - 1;
    out.setDate(out.getDate() - diff);
    return out;
}
function processStatus(process, history, now) {
    const runs = runsFor(process, history);
    const lastRun = runs[0] ?? null;
    const lastSuccess = runs.find(r => r.success) ?? null;
    const lastSuccessDate = lastSuccess ? (0, time_1.parseIso)(lastSuccess.date) : null;
    let status = 'pending';
    let note = '';
    switch (process.frequency) {
        case 'daily': {
            if (lastSuccessDate && sameLocalDay(lastSuccessDate, now)) {
                status = 'done';
                note = 'ran today';
            }
            else if (now.getHours() >= 12) {
                status = 'overdue';
                note = 'not run today';
            }
            else {
                status = 'pending';
                note = 'due today';
            }
            break;
        }
        case 'weekly': {
            // done = ran this ISO week; pending = ran last week (this week's run still due);
            // overdue = missed a whole week or never ran.
            const weekStart = startOfIsoWeek(now);
            const prevWeekStart = new Date(weekStart.getTime() - 7 * 86400000);
            if (lastSuccessDate && lastSuccessDate >= weekStart) {
                status = 'done';
                note = 'ran this week';
            }
            else if (lastSuccessDate && lastSuccessDate >= prevWeekStart) {
                status = 'pending';
                note = 'due this week';
            }
            else {
                status = 'overdue';
                note = lastSuccessDate ? 'missed last week' : 'never run';
            }
            break;
        }
        case 'monthly':
        default: {
            if (lastSuccessDate && sameLocalMonth(lastSuccessDate, now)) {
                status = 'done';
                note = 'ran this month';
            }
            else if (process.dayOfMonth !== undefined && now.getDate() > process.dayOfMonth) {
                status = 'overdue';
                note = `was due by day ${process.dayOfMonth}`;
            }
            else {
                status = 'pending';
                note = process.dayOfMonth !== undefined ? `due by day ${process.dayOfMonth}` : 'due this month';
            }
            break;
        }
    }
    // A failed run after the last success is worth surfacing even when the status is fine.
    if (lastRun && !lastRun.success && lastRun !== lastSuccess) {
        const lr = (0, time_1.parseIso)(lastRun.date);
        if (lr && (!lastSuccessDate || lr > lastSuccessDate))
            note += (note ? ' · ' : '') + 'last attempt failed';
    }
    return { process, status, lastRun, lastSuccess, note };
}
function calendarRows(processes, history, now) {
    return processes.map(p => processStatus(p, history, now));
}
//# sourceMappingURL=calendar.js.map