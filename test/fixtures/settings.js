// A complete Settings object for tests, mirroring src/settings.ts defaults, with overrides.
'use strict';
const ALL = ['summary', 'activeTask', 'warnings', 'lastCompleted', 'quickActions', 'processCalendar', 'timeline', 'deltaTracker', 'metrics', 'runHistory', 'warningTrends', 'scriptHealth', 'accessMap'];

function settings(o = {}) {
  const sections = Object.fromEntries(ALL.map(id => [id, true]));
  Object.assign(sections, o.sections || {});
  return {
    problems: o.problems || [],
    logsPath: 'logs',
    refreshInterval: 2000,
    staleRunningMinutes: 30,
    sections,
    // Same rule as src/settings.ts: listed sections first, everything else after.
    sectionOrder: o.sectionOrder ? [...o.sectionOrder, ...ALL.filter(s => !o.sectionOrder.includes(s))] : ALL.slice(),
    sidebarSections: o.sidebarSections || [],
    dashboard: { collapsible: true, density: 'comfortable', ...(o.dashboard || {}) },
    activeTask: { showLog: true, logLines: 6, showMetrics: true, showArtifacts: true, ...(o.activeTask || {}) },
    runHistory: { maxRows: 15, filters: true, detail: true, trend: true, anomalies: true, anomalyFactor: 2, ...(o.runHistory || {}) },
    timeline: { windowHours: 24, showFailed: true, ...(o.timeline || {}) },
    metricsExplorer: { maxRuns: 12, metrics: [], ...(o.metricsExplorer || {}) },
    warningTrends: { days: 14, top: 8, ...(o.warningTrends || {}) },
    processes: o.processes || [
      { name: 'Demo Pipeline', label: 'Demo', frequency: 'daily' },
      { name: 'Weekly Rollup', label: 'Weekly', frequency: 'weekly' },
      { name: 'Month-End Close', label: 'Close', frequency: 'monthly', dayOfMonth: 5 },
    ],
    calendar: { view: 'both', upcoming: true, ...(o.calendar || {}) },
    buttons: o.buttons || [
      { label: 'Run <it>', command: 'python x.py --m ${prompt:Month}', icon: 'play', group: 'Ops', task: 'Demo Pipeline' },
      { label: 'No confirm', command: 'echo hi', confirm: false },
    ],
    quickActions: { runVia: 'terminal', asTasks: true, contextMenu: true, disableWhileRunning: true, interpreters: { '.py': 'python' }, ...(o.quickActions || {}) },
    deltaMetrics: o.deltaMetrics || [],
    deltas: { formats: {}, thresholds: {}, points: 50, ...(o.deltas || {}) },
    staleHours: o.staleHours || 24,
    health: { resultDots: 5, ...(o.health || {}) },
    accessMap: { maxNodes: 150, layout: 'force', timeWindowDays: 0, labels: 'auto', sidebarPreview: true, replay: true, ambient: true, halos: true, glyphs: true, minimap: true, starfield: true, ...(o.accessMap || {}) },
    notifications: { onComplete: false, onFail: true, onStall: true, onWarning: false, onExit: true, onSlow: true, mirrorProgress: false, ...(o.notifications || {}) },
    statusBar: { enabled: true, idleMode: 'last', clickAction: 'menu' },
    badge: 'running',
  };
}
module.exports = { settings, ALL };
