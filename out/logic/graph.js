"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.taskNodeId = void 0;
exports.buildGraph = buildGraph;
exports.graphSummary = graphSummary;
const time_1 = require("./time");
const taskNodeId = (task) => `task:${task}`;
exports.taskNodeId = taskNodeId;
function buildGraph(access, progress, maxNodes) {
    if (!access || !Array.isArray(access.nodes))
        return { nodes: [], edges: [], activeTask: null, dropped: 0 };
    const running = progress && progress.status === 'running' ? progress : null;
    const activeTask = running ? (0, exports.taskNodeId)(running.task) : null;
    const liveIds = new Set(running?.accessed ?? []);
    if (activeTask)
        liveIds.add(activeTask);
    // Keep task nodes, then the most recently seen resources, up to the cap.
    const sorted = [...access.nodes].sort((a, b) => {
        if ((a.type === 'task') !== (b.type === 'task'))
            return a.type === 'task' ? -1 : 1;
        return ((0, time_1.parseIso)(b.lastSeen)?.getTime() ?? 0) - ((0, time_1.parseIso)(a.lastSeen)?.getTime() ?? 0);
    });
    const kept = sorted.slice(0, Math.max(1, maxNodes));
    const keptIds = new Set(kept.map(n => n.id));
    const dropped = sorted.length - kept.length;
    const edges = (access.edges ?? [])
        .filter(e => keptIds.has(e.from) && keptIds.has(e.to))
        .map(e => ({ ...e, live: !!activeTask && e.from === activeTask && liveIds.has(e.to) }));
    const degree = new Map();
    for (const e of edges) {
        degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
        degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    const nodes = kept.map(n => ({
        ...n,
        live: liveIds.has(n.id),
        degree: degree.get(n.id) ?? 0,
    }));
    return { nodes, edges, activeTask, dropped };
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