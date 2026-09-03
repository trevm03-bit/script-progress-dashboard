"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeWarning = normalizeWarning;
exports.warningTrendsModel = warningTrendsModel;
const time_1 = require("./time");
/**
 * The grouping key. "12 rows had no id" and "28 rows had no id" both become "# rows had no id",
 * so a recurring warning is one row rather than one row per run.
 */
function normalizeWarning(msg) {
    return String(msg ?? '')
        .replace(/\d+(?:[.,]\d+)*/g, '#')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
        .slice(0, 160);
}
function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function dayKey(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/** Every warning item in the history, timestamped (falling back to the run's own date). */
function occurrences(history) {
    const out = [];
    for (const run of history || []) {
        const items = run.warningItems;
        if (!Array.isArray(items) || items.length === 0)
            continue; // a bare count has no message
        for (const item of items) {
            if (!item || typeof item.msg !== 'string' || !item.msg.trim())
                continue;
            const itemTime = (0, time_1.parseIso)(item.time);
            const when = itemTime ?? (0, time_1.parseIso)(run.date);
            if (!when)
                continue;
            // Keep the timestamp exactly as written so the section can show it back unchanged.
            out.push({ msg: item.msg, task: run.task, time: itemTime ? item.time : run.date, t: when.getTime() });
        }
    }
    return out;
}
function warningTrendsModel(data, settings, now) {
    const cfg = settings.warningTrends || { days: 14, top: 5 };
    const windowDays = Math.max(1, Math.floor(cfg.days) || 1);
    const top = Math.max(1, Math.floor(cfg.top) || 1);
    // `windowDays` calendar days ending with today, oldest first.
    const today = startOfDay(now);
    const days = [];
    const index = new Map();
    for (let i = windowDays - 1; i >= 0; i--) {
        const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
        const key = dayKey(d);
        index.set(key, days.length);
        days.push({ date: key, label: key.slice(5), count: 0 });
    }
    const windowStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (windowDays - 1)).getTime();
    const inWindow = occurrences(data.history).filter(o => o.t >= windowStart && o.t <= now.getTime());
    inWindow.sort((a, b) => a.t - b.t);
    for (const o of inWindow) {
        const i = index.get(dayKey(new Date(o.t)));
        if (i !== undefined)
            days[i].count++;
    }
    // A third of the window at each end, at least one day, and never overlapping.
    const third = Math.max(1, Math.min(Math.floor(windowDays / 3), Math.floor(windowDays / 2)));
    const buckets = new Map();
    for (const o of inWindow) {
        const key = normalizeWarning(o.msg);
        const list = buckets.get(key);
        if (list)
            list.push(o);
        else
            buckets.set(key, [o]);
    }
    const groups = [];
    for (const [pattern, list] of buckets) {
        // list is already oldest-first (inWindow was sorted).
        const first = list[0];
        const last = list[list.length - 1];
        const tasks = [];
        for (let i = list.length - 1; i >= 0 && tasks.length < 5; i--) {
            if (!tasks.includes(list[i].task))
                tasks.push(list[i].task);
        }
        let early = 0;
        let late = 0;
        for (const o of list) {
            const i = index.get(dayKey(new Date(o.t)));
            if (i === undefined)
                continue;
            if (i < third)
                early++;
            if (i >= days.length - third)
                late++;
        }
        groups.push({
            pattern,
            example: last.msg,
            count: list.length,
            tasks,
            firstSeen: first.time,
            lastSeen: last.time,
            trend: late > early ? 'rising' : late < early ? 'falling' : 'flat',
        });
    }
    const at = (iso) => (0, time_1.parseIso)(iso)?.getTime() ?? 0;
    groups.sort((a, b) => b.count - a.count || at(b.lastSeen) - at(a.lastSeen) || a.pattern.localeCompare(b.pattern));
    const perTask = new Map();
    for (const o of inWindow)
        perTask.set(o.task, (perTask.get(o.task) || 0) + 1);
    const byTask = [...perTask.entries()]
        .map(([task, count]) => ({ task, count }))
        .sort((a, b) => b.count - a.count || a.task.localeCompare(b.task));
    return { total: inWindow.length, days, groups: groups.slice(0, top), byTask, windowDays };
}
//# sourceMappingURL=warningTrends.js.map