// Access Map data shaping: cap the graph, mark what is live, compute degrees.
// Layout and drawing happen in the webview (media/accessMap.js); this only decides WHAT is drawn.
import { AccessEdge, AccessGraph, AccessNode, ProgressData } from '../types';
import { parseIso } from './time';

export interface DrawNode extends AccessNode {
  /** Touched by the currently running task. */
  live: boolean;
  /** Number of edges. Hubs draw larger. */
  degree: number;
}
export interface DrawEdge extends AccessEdge {
  live: boolean;
}
export interface DrawGraph {
  nodes: DrawNode[];
  edges: DrawEdge[];
  /** Id of the running task's node, if any. */
  activeTask: string | null;
  /** How many nodes were dropped by the cap. */
  dropped: number;
}

export const taskNodeId = (task: string) => `task:${task}`;

export function buildGraph(access: AccessGraph | null, progress: ProgressData | null, maxNodes: number): DrawGraph {
  if (!access || !Array.isArray(access.nodes)) return { nodes: [], edges: [], activeTask: null, dropped: 0 };

  const running = progress && progress.status === 'running' ? progress : null;
  const activeTask = running ? taskNodeId(running.task) : null;
  const liveIds = new Set<string>(running?.accessed ?? []);
  if (activeTask) liveIds.add(activeTask);

  // Keep task nodes, then the most recently seen resources, up to the cap.
  const sorted = [...access.nodes].sort((a, b) => {
    if ((a.type === 'task') !== (b.type === 'task')) return a.type === 'task' ? -1 : 1;
    return (parseIso(b.lastSeen)?.getTime() ?? 0) - (parseIso(a.lastSeen)?.getTime() ?? 0);
  });
  const kept = sorted.slice(0, Math.max(1, maxNodes));
  const keptIds = new Set(kept.map(n => n.id));
  const dropped = sorted.length - kept.length;

  const edges: DrawEdge[] = (access.edges ?? [])
    .filter(e => keptIds.has(e.from) && keptIds.has(e.to))
    .map(e => ({ ...e, live: !!activeTask && e.from === activeTask && liveIds.has(e.to) }));

  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }

  const nodes: DrawNode[] = kept.map(n => ({
    ...n,
    live: liveIds.has(n.id),
    degree: degree.get(n.id) ?? 0,
  }));

  return { nodes, edges, activeTask, dropped };
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
