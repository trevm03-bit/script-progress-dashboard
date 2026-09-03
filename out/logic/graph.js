"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskNodeId = void 0;
exports.buildGraph = buildGraph;
exports.graphSummary = graphSummary;
const time_1 = require("./time");
const taskNodeId = (task) => `task:${task}`;
exports.taskNodeId = taskNodeId;
function buildGraph(access, tasks, maxNodes, timeWindowDays = 0, now = new Date()) {
    if (!access || !Array.isArray(access.nodes))
        return { nodes: [], edges: [], activeTasks: [], dropped: 0 };
    const running = tasks.filter(t => t.status === 'running');
    const activeTasks = running.map(t => (0, exports.taskNodeId)(t.task));
    const liveIds = new Set(activeTasks);
    for (const r of running)
        for (const id of r.accessed ?? [])
            liveIds.add(id);
    const cutoff = timeWindowDays > 0 ? now.getTime() - timeWindowDays * 86400000 : 0;
    const recent = (iso) => !cutoff || ((0, time_1.parseIso)(iso)?.getTime() ?? 0) >= cutoff;
    const inWindow = access.nodes.filter(n => n && n.id && (recent(n.lastSeen) || liveIds.has(n.id)));
    // Keep task nodes, then the most recently seen resources, up to the cap.
    const sorted = [...inWindow].sort((a, b) => {
        if ((a.type === 'task') !== (b.type === 'task'))
            return a.type === 'task' ? -1 : 1;
        return ((0, time_1.parseIso)(b.lastSeen)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.lastSeen)?.getTime() ?? 0);
    });
    const kept = sorted.slice(0, Math.max(1, maxNodes));
    const keptIds = new Set(kept.map(n => n.id));
    const dropped = access.nodes.length - kept.length;
    const edges = (access.edges ?? [])
        .filter(e => e && keptIds.has(e.from) && keptIds.has(e.to) && (recent(e.lastSeen) || liveIds.has(e.to)))
        .map(e => ({ ...e, live: liveIds.has(e.from) && liveIds.has(e.to) && activeTasks.includes(e.from) }));
    const degree = new Map();
    const reads = new Map();
    const writes = new Map();
    for (const e of edges) {
        degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
        degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
        const bucket = e.mode === 'write' ? writes : reads;
        bucket.set(e.to, (bucket.get(e.to) ?? 0) + (e.count || 1));
        bucket.set(e.from, (bucket.get(e.from) ?? 0) + (e.count || 1));
    }
    const nodes = kept.map(n => ({
        ...n,
        live: liveIds.has(n.id),
        degree: degree.get(n.id) ?? 0,
        reads: reads.get(n.id) ?? 0,
        writes: writes.get(n.id) ?? 0,
    }));
    return { nodes, edges, activeTasks, dropped };
}
/** Counts for the sidebar summary card. */
function graphSummary(g) {
    let lastSeen = null;
    let lastT = 0;
    for (const n of g.nodes) {
        const t = (0, time_1.parseIso)(n.lastSeen)?.getTime() ?? 0;
        if (t > lastT) {
            lastT = t;
            lastSeen = n.lastSeen;
        }
    }
    return {
        tasks: g.nodes.filter(n => n.type === 'task').length,
        resources: g.nodes.filter(n => n.type !== 'task').length,
        edges: g.edges.length,
        lastSeen,
    };
}
//# sourceMappingURL=graph.js.map