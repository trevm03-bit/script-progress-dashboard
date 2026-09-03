"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.metricsModel = metricsModel;
const anomaly_1 = require("./anomaly");
const time_1 = require("./time");
/** The metrics of one run, minus anything the filter excludes; null when nothing is left. */
function pickMetrics(metrics, allow) {
    if (!metrics || typeof metrics !== 'object')
        return null;
    const out = Object.create(null);
    let n = 0;
    for (const [key, value] of Object.entries(metrics)) {
        if (allow && !allow.has(key))
            continue;
        if (value === null || value === undefined)
            continue;
        if (typeof value !== 'number' && typeof value !== 'string')
            continue;
        out[key] = value;
        n++;
    }
    return n ? out : null;
}
function metricsModel(data, settings) {
    const cfg = settings.metricsExplorer || { maxRuns: 5, metrics: [] };
    const maxRuns = Math.max(1, Math.floor(cfg.maxRuns) || 1);
    const wanted = (cfg.metrics || []).filter(m => typeof m === 'string' && m.length > 0);
    const allow = wanted.length ? new Set(wanted) : null;
    // Group the history by task, keeping only runs that still have a metric after filtering.
    const byTask = new Map();
    for (const run of data.history || []) {
        const metrics = pickMetrics(run.metrics, allow);
        if (!metrics)
            continue;
        const list = byTask.get(run.task);
        const entry = { run, metrics, t: (0, time_1.parseIso)(run.date)?.getTime() ?? 0 };
        if (list)
            list.push(entry);
        else
            byTask.set(run.task, [entry]);
    }
    const allKeys = new Set();
    const tasks = [];
    for (const [task, entries] of byTask) {
        entries.sort((a, b) => a.t - b.t); // oldest first …
        const used = entries.slice(-maxRuns); // … so slice(-n) keeps the newest, newest LAST
        const keys = [...new Set(used.flatMap(e => Object.keys(e.metrics)))].sort();
        keys.forEach(k => allKeys.add(k));
        const runs = used.map(e => ({ date: e.run.date, success: !!e.run.success, runId: e.run.runId }));
        // Fold each key down to its latest and previous value, then let metricChanges do the maths so
        // the explorer and the Run History detail row agree (including previous = 0 -> pct null).
        const latestMetrics = {};
        const previousMetrics = {};
        const valuesByKey = new Map();
        for (const key of keys) {
            const values = used.map(e => (key in e.metrics ? e.metrics[key] : undefined));
            valuesByKey.set(key, values);
            const present = [];
            for (const v of values)
                if (v !== undefined)
                    present.push(v);
            if (present.length >= 1)
                latestMetrics[key] = present[present.length - 1];
            if (present.length >= 2)
                previousMetrics[key] = present[present.length - 2];
        }
        const newest = used[used.length - 1].run;
        const changes = new Map((0, anomaly_1.metricChanges)({ ...newest, metrics: latestMetrics }, { ...newest, metrics: previousMetrics }).map(c => [c.key, c]));
        const rows = keys.map(key => {
            const values = valuesByKey.get(key);
            const present = values.filter((v) => v !== undefined);
            const numeric = present.length > 0 && present.every(v => typeof v === 'number' && isFinite(v));
            const series = numeric ? present : [];
            const change = changes.get(key);
            return {
                key,
                values,
                numeric,
                series,
                latest: latestMetrics[key],
                previous: previousMetrics[key],
                delta: change?.delta ?? null,
                pct: change?.pct ?? null,
                min: series.length ? Math.min(...series) : null,
                max: series.length ? Math.max(...series) : null,
            };
        });
        tasks.push({ task, runs, keys, rows, latestDate: newest.date });
    }
    // Most recently active task first.
    tasks.sort((a, b) => ((0, time_1.parseIso)(b.latestDate)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.latestDate)?.getTime() ?? 0));
    return { tasks, metricCount: allKeys.size, taskCount: tasks.length };
}
//# sourceMappingURL=metricsExplorer.js.map