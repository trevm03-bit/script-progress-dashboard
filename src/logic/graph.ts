// Access Map data shaping: cap the graph, apply the time window, mark what is live, compute
// degrees. Layout and drawing happen in the webview (media/accessMap.js); this only decides
// WHAT is drawn.
import { AccessEdge, AccessGraph, AccessNode, ProgressData } from '../types';
import { parseIso } from './time';

export interface DrawNode extends AccessNode {
  /** Touched by a currently running task. */
  live: boolean;
  /** Number of edges. Hubs draw larger. */
  degree: number;
  /** Reads / writes touching this node (for the detail card). */
  reads: number;
  writes: number;
}
export interface DrawEdge extends AccessEdge {
  live: boolean;
}
export interface DrawGraph {
  nodes: DrawNode[];
  edges: DrawEdge[];
  /** Ids of running tasks' nodes. */
  activeTasks: string[];
  /** How many nodes were dropped by the cap or the time window. */
  dropped: number;
}

export const taskNodeId = (task: string) => `task:${task}`;

export function buildGraph(access: AccessGraph | null, tasks: ProgressData[], maxNodes: number, timeWindowDays = 0, now = new Date()): DrawGraph {
  if (!access || !Array.isArray(access.nodes)) return { nodes: [], edges: [], activeTasks: [], dropped: 0 };

  const running = tasks.filter(t => t.status === 'running');
  const activeTasks = running.map(t => taskNodeId(t.task));
  const liveIds = new Set<string>(activeTasks);
  for (const r of running) for (const id of r.accessed ?? []) liveIds.add(id);

  const cutoff = timeWindowDays > 0 ? now.getTime() - timeWindowDays * 86400000 : 0;
  const recent = (iso: string) => !cutoff || (parseIso(iso)?.getTime() ?? 0) >= cutoff;

  const inWindow = access.nodes.filter(n => n && n.id && (recent(n.lastSeen) || liveIds.has(n.id)));
  // Keep task nodes, then the most recently seen resources, up to the cap.
  const sorted = [...inWindow].sort((a, b) => {
    if ((a.type === 'task') !== (b.type === 'task')) return a.type === 'task' ? -1 : 1;
    return (parseIso(b.lastSeen)?.getTime() ?? 0) - (parseIso(a.lastSeen)?.getTime() ?? 0);
  });
  const kept = sorted.slice(0, Math.max(1, maxNodes));
  const keptIds = new Set(kept.map(n => n.id));
  const dropped = access.nodes.length - kept.length;

  const edges: DrawEdge[] = (access.edges ?? [])
    .filter(e => e && keptIds.has(e.from) && keptIds.has(e.to) && (recent(e.lastSeen) || liveIds.has(e.to)))
    .map(e => ({ ...e, live: liveIds.has(e.from) && liveIds.has(e.to) && activeTasks.includes(e.from) }));

  const degree = new Map<string, number>();
  const reads = new Map<string, number>();
  const writes = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    const bucket = e.mode === 'write' ? writes : reads;
    bucket.set(e.to, (bucket.get(e.to) ?? 0) + (e.count || 1));
    bucket.set(e.from, (bucket.get(e.from) ?? 0) + (e.count || 1));
  }

  const nodes: DrawNode[] = kept.map(n => ({
    ...n,
    live: liveIds.has(n.id),
    degree: degree.get(n.id) ?? 0,
    reads: reads.get(n.id) ?? 0,
    writes: writes.get(n.id) ?? 0,
  }));

  return { nodes, edges, activeTasks, dropped };
}

/** Counts for the sidebar summary card. */
export function graphSummary(g: DrawGraph): { tasks: number; resources: number; edges: number; lastSeen: string | null } {
  let lastSeen: string | null = null;
  let lastT = 0;
  for (const n of g.nodes) {
    const t = parseIso(n.lastSeen)?.getTime() ?? 0;
    if (t > lastT) { lastT = t; lastSeen = n.lastSeen; }
  }
  return {
    tasks: g.nodes.filter(n => n.type === 'task').length,
    resources: g.nodes.filter(n => n.type !== 'task').length,
    edges: g.edges.length,
    lastSeen,
  };
}
