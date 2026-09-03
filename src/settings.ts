// One typed snapshot of every scriptProgress.* setting. Read it fresh on each refresh so
// changes in Settings apply without a reload.
import * as vscode from 'vscode';
import { ALL_SECTIONS, ProcessConfig, QuickActionConfig, SectionConfig, SectionId, Settings } from './types';

export function readSettings(): Settings {
  const c = vscode.workspace.getConfiguration('scriptProgress');
  const num = (key: string, def: number, min: number, max = Infinity) => {
    const v = c.get<number>(key, def);
    return typeof v === 'number' && isFinite(v) && v >= min && v <= max ? v : def;
  };
  const str = <T extends string>(key: string, def: T, allowed: readonly T[]): T => {
    const v = c.get<T>(key, def);
    return allowed.includes(v) ? v : def;
  };
  const bool = (key: string, def: boolean) => c.get<boolean>(key, def) !== false && (c.get<boolean>(key, def) === true || def);
  const sectionList = (key: string): SectionId[] =>
    (c.get<string[]>(key, []) || []).filter((s): s is SectionId => (ALL_SECTIONS as string[]).includes(s));

  const sections = {} as SectionConfig;
  const defaults: SectionConfig = {
    summary: true, activeTask: true, warnings: true, lastCompleted: true, runHistory: true,
    quickActions: false, processCalendar: false, deltaTracker: false, scriptHealth: false, accessMap: false,
  };
  for (const s of ALL_SECTIONS) sections[s] = c.get<boolean>(`sections.${s}`, defaults[s]);

  const order = sectionList('dashboard.sectionOrder');
  const sectionOrder: SectionId[] = [...order, ...ALL_SECTIONS.filter(s => !order.includes(s))];

  return {
    logsPath: c.get<string>('logsPath', 'logs') || 'logs',
    refreshInterval: num('refreshInterval', 2000, 500),
    staleRunningMinutes: num('staleRunningMinutes', 30, 1),
    sections,
    sectionOrder,
    sidebarSections: sectionList('dashboard.sidebarSections'),
    dashboard: {
      collapsible: bool('dashboard.collapsible', true),
      density: str('dashboard.density', 'comfortable', ['comfortable', 'compact'] as const),
    },
    activeTask: {
      showLog: bool('activeTask.showLog', true),
      logLines: num('activeTask.logLines', 6, 1, 50),
      showMetrics: bool('activeTask.showMetrics', true),
      showArtifacts: bool('activeTask.showArtifacts', true),
    },
    runHistory: {
      maxRows: num('runHistory.maxRows', 15, 1),
      filters: bool('runHistory.filters', true),
      detail: bool('runHistory.detail', true),
      trend: bool('runHistory.trend', true),
    },
    processes: (c.get<ProcessConfig[]>('processCalendar.processes', []) || []).filter(p => p && p.name),
    calendar: {
      view: str('processCalendar.view', 'both', ['list', 'grid', 'both'] as const),
      upcoming: bool('processCalendar.upcoming', true),
    },
    buttons: (c.get<QuickActionConfig[]>('quickActions.buttons', []) || []).filter(b => b && b.label && b.command),
    quickActions: {
      runVia: str('quickActions.runVia', 'terminal', ['terminal', 'task'] as const),
      asTasks: bool('quickActions.asTasks', true),
      contextMenu: bool('quickActions.contextMenu', true),
      disableWhileRunning: bool('quickActions.disableWhileRunning', true),
      interpreters: c.get<Record<string, string>>('quickActions.interpreters', {}) || {},
    },
    deltaMetrics: (c.get<string[]>('deltaTracker.metrics', []) || []).filter(m => typeof m === 'string' && m),
    deltas: {
      formats: c.get('deltaTracker.formats', {}) || {},
      thresholds: c.get('deltaTracker.thresholds', {}) || {},
      points: num('deltaTracker.points', 50, 2),
    },
    staleHours: num('scriptHealth.staleHours', 168, 1),
    health: { resultDots: num('scriptHealth.resultDots', 5, 0, 20) },
    accessMap: {
      maxNodes: num('accessMap.maxNodes', 150, 10),
      layout: str('accessMap.layout', 'force', ['force', 'radial'] as const),
      timeWindowDays: num('accessMap.timeWindowDays', 0, 0),
      labels: str('accessMap.labels', 'auto', ['auto', 'all', 'scripts'] as const),
      sidebarPreview: bool('accessMap.sidebarPreview', true),
      replay: bool('accessMap.replay', true),
    },
    notifications: {
      onComplete: bool('notifications.onComplete', false),
      onFail: bool('notifications.onFail', true),
      onStall: bool('notifications.onStall', true),
      onWarning: bool('notifications.onWarning', false),
      onExit: bool('notifications.onExit', true),
      mirrorProgress: bool('notifications.mirrorProgress', false),
    },
    statusBar: {
      enabled: bool('statusBar.enabled', true),
      idleMode: str('statusBar.idleMode', 'last', ['last', 'hidden'] as const),
      clickAction: str('statusBar.clickAction', 'menu', ['menu', 'dashboard'] as const),
    },
    badge: str('badge', 'running', ['running', 'failures', 'off'] as const),
  };
}
