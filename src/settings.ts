// One typed snapshot of every scriptProgress.* setting. Read it fresh on each refresh so
// changes in Settings apply without a reload.
import * as vscode from 'vscode';
import { ProcessConfig, QuickActionConfig, Settings } from './types';

export function readSettings(): Settings {
  const c = vscode.workspace.getConfiguration('scriptProgress');
  const num = (key: string, def: number, min: number) => {
    const v = c.get<number>(key, def);
    return typeof v === 'number' && isFinite(v) && v >= min ? v : def;
  };
  return {
    logsPath: c.get<string>('logsPath', 'logs') || 'logs',
    refreshInterval: num('refreshInterval', 2000, 500),
    staleRunningMinutes: num('staleRunningMinutes', 30, 1),
    statusBarEnabled: c.get<boolean>('statusBar.enabled', true),
    sections: {
      activeTask: c.get<boolean>('sections.activeTask', true),
      warnings: c.get<boolean>('sections.warnings', true),
      lastCompleted: c.get<boolean>('sections.lastCompleted', true),
      runHistory: c.get<boolean>('sections.runHistory', true),
      processCalendar: c.get<boolean>('sections.processCalendar', false),
      quickActions: c.get<boolean>('sections.quickActions', false),
      deltaTracker: c.get<boolean>('sections.deltaTracker', false),
      scriptHealth: c.get<boolean>('sections.scriptHealth', false),
      accessMap: c.get<boolean>('sections.accessMap', false),
    },
    runHistoryMaxRows: num('runHistory.maxRows', 15, 1),
    processes: (c.get<ProcessConfig[]>('processCalendar.processes', []) || []).filter(p => p && p.name),
    buttons: (c.get<QuickActionConfig[]>('quickActions.buttons', []) || []).filter(b => b && b.label && b.command),
    deltaMetrics: (c.get<string[]>('deltaTracker.metrics', []) || []).filter(m => typeof m === 'string' && m),
    staleHours: num('scriptHealth.staleHours', 168, 1),
    accessMapMaxNodes: num('accessMap.maxNodes', 150, 10),
  };
}
