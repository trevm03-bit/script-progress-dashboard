// Shared shapes. The JSON files written by python/progress.py (and reporters/progress.js) are the
// contract; these interfaces describe them exactly. Nothing here imports 'vscode', so the pure
// modules (logic/, render/) can be unit-tested with plain Node.

/** progress.json and progress/<slug>.json — a task's current (or most recent) state. */
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
  /** Optional, from newer reporters. */
  runId?: string;
  startedAt?: string;
  /** 0..1 progress within the current step (Progress.substep). */
  substep?: number | null;
  metrics?: Record<string, number | string>;
  log?: LogLine[];
  artifacts?: string[];
  /** Access-map node ids touched during this run. */
  accessed?: string[];
}

export interface Warning {
  time: string;
  msg: string;
  /** How many things this warning is about, so a steady count reads as steady. */
  count?: number;
  /** The reporter's own word for the kind of finding, for grouping and trending. */
  category?: string;
  severity?: 'info' | 'warn' | 'error';
  /** True when a human has to go and do something about it, not merely know about it. */
  actionable?: boolean;
}

export interface LogLine {
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
  runId?: string;
  startedAt?: string;
  metrics?: Record<string, number | string>;
  warningItems?: Warning[];
  accessed?: string[];
  artifacts?: string[];
  /** Free-text kind of failure the script named, e.g. "auth", "quota". Failures only. */
  category?: string;
  /** Who ran it (OS username), when the reporter was allowed to record it. */
  user?: string;
  /** Short commit the scripts were on, so behaviour can be lined up against code. */
  commit?: string;
  /** Cumulative contributions this run made, by metric. */
  impacts?: Record<string, number>;
}

/** deltas.json: metric name -> points. */
export interface DeltaPoint {
  date: string;
  value: number;
  task: string;
  /** Which run produced it, so several points from one run can be told apart from a trend. */
  runId?: string;
}
export type DeltaSeries = Record<string, DeltaPoint[]>;

/** impact.json — what each run contributed, accumulated rather than replaced. */
export interface ImpactPoint {
  date: string;
  value: number;
  task: string;
  runId?: string;
  label?: string;
}
export type ImpactSeries = Record<string, ImpactPoint[]>;

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
  /** Optional note from the reporter about what was actually done, e.g. "5 records updated". */
  detail?: string;
}
export interface AccessGraph {
  nodes: AccessNode[];
  edges: AccessEdge[];
}

/**
 * Something the EXTENSION observed about a run that the files do not know: a Quick Action's
 * process exited with a non-zero code while its task was still marked running. Kept in memory;
 * the extension never writes the data files.
 */
export interface RunOverlay {
  task: string;
  startedAt?: string;
  exitCode: number;
  when: string;
}

/** Everything the dashboard renders from, read in one pass. */
export interface DashboardData {
  /** The most recently written task (progress.json). */
  progress: ProgressData | null;
  /** Every task slot (progress/*.json) plus progress.json, de-duplicated. Running ones first. */
  tasks: ProgressData[];
  history: RunRecord[];
  deltas: DeltaSeries;
  impact: ImpactSeries;
  access: AccessGraph | null;
  overlays: RunOverlay[];
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
  dayOfWeek?: number;
  dueHour?: number;
  /** SLA: a run of this process longer than this many minutes is flagged (and notified if enabled). */
  maxMinutes?: number;
  /** Notify this many days before the due date, instead of only once it has been missed. */
  reminderDays?: number;
  /**
   * Task-name prefixes that must have run successfully THIS PERIOD before this process can.
   * A process whose dependency has not run is reported as blocked, not overdue — there is
   * nothing the reader can do about it yet, and calling it overdue blames the wrong step.
   * It means exactly "the named process has not run in this period"; it cannot know about a
   * human step, such as waiting for someone to send a file back.
   */
  dependsOn?: string[];
  /**
   * Task names of the phases this process is made of, when it is not one script. The process
   * counts as done only when every phase has run successfully in the period; until then it
   * reports "2 of 3 phases". Each name is matched as a prefix, like `name` itself.
   */
  subtasks?: string[];
}

export interface QuickActionConfig {
  label: string;
  command: string;
  icon?: string;
  confirm?: boolean;
  group?: string;
  cwd?: string;
  task?: string;
}

export type SectionId =
  | 'summary' | 'activeTask' | 'warnings' | 'lastCompleted' | 'quickActions'
  | 'processCalendar' | 'timeline' | 'deltaTracker' | 'metrics' | 'runHistory'
  | 'warningTrends' | 'scriptHealth' | 'accessMap';

export const ALL_SECTIONS: SectionId[] = [
  'summary', 'activeTask', 'warnings', 'lastCompleted', 'quickActions',
  'processCalendar', 'timeline', 'deltaTracker', 'metrics', 'runHistory',
  'warningTrends', 'scriptHealth', 'accessMap',
];

export const SECTION_TITLES: Record<SectionId, string> = {
  summary: 'Summary strip',
  activeTask: 'Active Task',
  warnings: 'Warnings',
  lastCompleted: 'Last Completed',
  quickActions: 'Quick Actions',
  processCalendar: 'Process Calendar',
  timeline: 'Run Timeline',
  deltaTracker: 'Delta Tracker',
  metrics: 'Metrics Explorer',
  runHistory: 'Run History',
  warningTrends: 'Warning Trends',
  scriptHealth: 'Script Health',
  accessMap: 'Access Map',
};

/** Codicon per section, for titles and pickers. */
export const SECTION_ICONS: Record<SectionId, string> = {
  summary: 'dashboard', activeTask: 'pulse', warnings: 'warning', lastCompleted: 'check-all', quickActions: 'play',
  processCalendar: 'calendar', timeline: 'timeline-view-icon', deltaTracker: 'graph-line', metrics: 'table', runHistory: 'history',
  warningTrends: 'flame', scriptHealth: 'heart', accessMap: 'graph',
};

export type SectionConfig = Record<SectionId, boolean>;

export interface DeltaFormat { unit?: string; decimals?: number; label?: string }
export interface DeltaThreshold { min?: number; max?: number }

export interface Settings {
  /** Settings that will not behave as written. Surfaced in the section they belong to. */
  problems: import('./logic/validate').Problem[];
  logsPath: string;
  refreshInterval: number;
  staleRunningMinutes: number;
  sections: SectionConfig;
  sectionOrder: SectionId[];
  sidebarSections: SectionId[];
  dashboard: { collapsible: boolean; density: 'comfortable' | 'compact' };
  activeTask: { showLog: boolean; logLines: number; showMetrics: boolean; showArtifacts: boolean };
  runHistory: { maxRows: number; filters: boolean; detail: boolean; trend: boolean; anomalies: boolean; anomalyFactor: number };
  timeline: { windowHours: number; showFailed: boolean };
  metricsExplorer: { totals: boolean; maxRuns: number; metrics: string[] };
  warningTrends: { days: number; top: number };
  processes: ProcessConfig[];
  calendar: { view: 'list' | 'grid' | 'both'; upcoming: boolean };
  buttons: QuickActionConfig[];
  quickActions: { runVia: 'terminal' | 'task'; asTasks: boolean; contextMenu: boolean; disableWhileRunning: boolean; interpreters: Record<string, string> };
  deltaMetrics: string[];
  deltas: { formats: Record<string, DeltaFormat>; thresholds: Record<string, DeltaThreshold>; points: number };
  staleHours: number;
  health: { resultDots: number };
  accessMap: { maxNodes: number; layout: 'force' | 'radial'; timeWindowDays: number; labels: 'auto' | 'all' | 'scripts'; sidebarPreview: boolean; replay: boolean; ambient: boolean; halos: boolean; glyphs: boolean; minimap: boolean; starfield: boolean };
  notifications: { onComplete: boolean; onFail: boolean; onStall: boolean; onWarning: boolean; onExit: boolean; onSlow: boolean; mirrorProgress: boolean };
  events: { file: boolean };
  statusBar: { enabled: boolean; idleMode: 'last' | 'hidden'; clickAction: 'menu' | 'dashboard' };
  badge: 'running' | 'failures' | 'off';
}

/** What the Active Task section and status bar show. 'stalled' = running but not updated for too long; 'exited' = process ended non-zero while still 'running'. */
export type TaskState = 'running' | 'stalled' | 'exited' | 'complete' | 'failed' | 'idle';

/** Where the dashboard is being rendered. */
export type Surface = 'sidebar' | 'panel' | 'map';
