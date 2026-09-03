// Shared shapes. The JSON files written by python/progress.py are the contract;
// these interfaces describe them exactly. Nothing here imports 'vscode', so the
// pure modules (logic/, render/) can be unit-tested with plain Node.

/** progress.json — the current (or most recent) task. */
export interface ProgressData {
  task: string;
  status: 'running' | 'complete' | 'failed';
  step: number;
  totalSteps: number;
  label: string;
  detail: string;
  /** Seconds elapsed at the moment the file was written. */
  elapsed: number;
  /** Estimated seconds remaining, or null when there is no prior run to estimate from. */
  eta: number | null;
  warnings: Warning[];
  /** ISO timestamp of the last write. Used for live elapsed and stall detection. */
  updatedAt: string;
  /** Access-map node ids touched during this run (optional, added by Progress.access()). */
  accessed?: string[];
}

export interface Warning {
  time: string;
  msg: string;
}

/** One row of run_history.json. */
export interface RunRecord {
  task: string;
  date: string;
  success: boolean;
  elapsed: number;
  summary: string;
  warnings: number;
}

/** deltas.json: metric name -> points. */
export interface DeltaPoint {
  date: string;
  value: number;
  task: string;
}
export type DeltaSeries = Record<string, DeltaPoint[]>;

/** access.json — which tasks touch which resources. */
export type AccessNodeType = 'task' | 'file' | 'table' | 'api' | 'other';
export interface AccessNode {
  id: string;
  type: AccessNodeType;
  label: string;
  lastSeen: string;
}
export interface AccessEdge {
  from: string;
  to: string;
  mode: 'read' | 'write';
  count: number;
  lastSeen: string;
}
export interface AccessGraph {
  nodes: AccessNode[];
  edges: AccessEdge[];
}

/** Everything the dashboard renders from, read in one pass. */
export interface DashboardData {
  progress: ProgressData | null;
  history: RunRecord[];
  deltas: DeltaSeries;
  access: AccessGraph | null;
  /** Absolute folder the files were read from. */
  logsDir: string;
  logsDirExists: boolean;
  /** Human-readable read problems (a half-written file, bad JSON). Shown, never fatal. */
  readErrors: string[];
}

/** Settings shapes (mirrors package.json contributes.configuration). */
export interface ProcessConfig {
  name: string;
  label: string;
  frequency: 'monthly' | 'weekly' | 'daily';
  dayOfMonth?: number;
}

export interface QuickActionConfig {
  label: string;
  command: string;
  icon?: string;
  confirm?: boolean;
  group?: string;
}

export interface SectionConfig {
  activeTask: boolean;
  warnings: boolean;
  lastCompleted: boolean;
  runHistory: boolean;
  processCalendar: boolean;
  quickActions: boolean;
  deltaTracker: boolean;
  scriptHealth: boolean;
  accessMap: boolean;
}

export interface Settings {
  logsPath: string;
  refreshInterval: number;
  staleRunningMinutes: number;
  statusBarEnabled: boolean;
  sections: SectionConfig;
  runHistoryMaxRows: number;
  processes: ProcessConfig[];
  buttons: QuickActionConfig[];
  deltaMetrics: string[];
  staleHours: number;
  accessMapMaxNodes: number;
}

/** What the Active Task section and status bar show. 'stalled' = running but not updated for too long. */
export type TaskState = 'running' | 'stalled' | 'complete' | 'failed' | 'idle';

/** Where the dashboard is being rendered; the sidebar is narrow and cannot host the canvas map. */
export type Surface = 'sidebar' | 'panel';
