// Active Task: one card per task. Running ones first (progress bar, step, substep, elapsed, ETA,
// log tail, metric chips, artifacts), then the most recent finished one.
import { DashboardData, ProgressData, Settings, TaskState } from '../types';
import { formatDuration, liveElapsed, liveEta, minutesSinceUpdate, percent, taskState, exitOverlayFor, clockTime } from '../logic/time';
import { esc, icon, section, empty, chip, metricText, SectionOpts } from './html';

const STATE_ICON: Record<TaskState, string> = {
  running: 'sync~spin', stalled: 'warning', exited: 'debug-disconnect', complete: 'check', failed: 'error', idle: 'circle-outline',
};
const STATE_LABEL: Record<TaskState, string> = {
  running: 'Running', stalled: 'Stalled', exited: 'Exited', complete: 'Complete', failed: 'Failed', idle: 'Idle',
};

export function renderActiveTask(data: DashboardData, settings: Settings, now: Date, opts: SectionOpts): string {
  if (!data.tasks.length) {
    const hint = data.logsDirExists
      ? 'No progress.json yet. It appears the first time a script reports.'
      : `Logs folder not found: ${data.logsDir}`;
    return section('activeTask', 'Active Task', empty(hint, { msg: 'simulate', label: 'Simulate a demo run', icon: 'beaker' }), opts);
  }
  const running = data.tasks.filter(t => t.status === 'running');
  const cards = running.length ? running : [data.tasks[0]];
  const body = cards.map(t => taskCard(t, data, settings, now)).join('');
  const title = running.length > 1 ? `Active Tasks (${running.length})` : 'Active Task';
  return section('activeTask', title, body, { ...opts, cls: `task-${taskState(cards[0], settings.staleRunningMinutes, now, data.overlays)}` });
}

function taskCard(p: ProgressData, data: DashboardData, settings: Settings, now: Date): string {
  const state = taskState(p, settings.staleRunningMinutes, now, data.overlays);
  const pct = percent(p.step, p.totalSteps, p.substep);
  const elapsed = liveElapsed(p, now);
  const eta = liveEta(p, now);
  const stepText = p.totalSteps > 0 ? `Step ${p.step}/${p.totalSteps}` : '';
  const sub = typeof p.substep === 'number' && p.substep > 0 && p.substep < 1 && state === 'running' ? ` <span class="muted">(${Math.round(p.substep * 100)}%)</span>` : '';

  let stateNote = '';
  if (state === 'stalled') stateNote = `<div class="state-note status-warn">${icon('warning')} No update for ${Math.round(minutesSinceUpdate(p, now))} min — the script may have stopped without reporting.</div>`;
  if (state === 'exited') {
    const o = exitOverlayFor(p, data.overlays);
    stateNote = `<div class="state-note status-fail">${icon('debug-disconnect')} The process exited with code ${o?.exitCode ?? '?'} while the script still reported "running".</div>`;
  }

  const meta: string[] = [];
  meta.push(`<span title="Elapsed">${icon('watch')} ${esc(formatDuration(elapsed))}</span>`);
  if (state === 'running' && eta !== null) meta.push(`<span title="Estimated remaining, from prior runs">${icon('history')} ~${esc(formatDuration(eta))} left</span>`);
  if (p.warnings && p.warnings.length) meta.push(`<span class="status-warn" title="Warnings this run">${icon('warning')} ${p.warnings.length}</span>`);
  if (p.startedAt) meta.push(`<span class="muted" title="Started">${icon('play')} ${esc(clockTime(p.startedAt))}</span>`);
  if (p.runId) meta.push(`<span class="muted mono" title="Run id">${esc(p.runId)}</span>`);

  const metrics = settings.activeTask.showMetrics && p.metrics && Object.keys(p.metrics).length
    ? `<div class="chips">${Object.entries(p.metrics).map(([k, v]) => chip(k, metricText(v))).join('')}</div>` : '';

  const log = settings.activeTask.showLog && p.log && p.log.length
    ? `<div class="log-tail">${p.log.slice(-settings.activeTask.logLines).map(l => `<div class="log-line"><span class="log-time">${esc(clockTime(l.time))}</span>${esc(l.msg)}</div>`).join('')}</div>` : '';

  const artifacts = settings.activeTask.showArtifacts && p.artifacts && p.artifacts.length
    ? `<div class="artifacts">${p.artifacts.map(a => `<button class="link-btn" data-open="${esc(a)}" title="${esc(a)}">${icon('file')}${esc(a.split(/[\\/]/).pop() || a)}</button>`).join('')}</div>` : '';

  return `<div class="task-card state-${state}">
  <div class="task-head">
    <span class="task-state state-${state}">${icon(STATE_ICON[state])} ${STATE_LABEL[state]}</span>
    <span class="task-name" title="${esc(p.task)}">${esc(p.task)}</span>
  </div>
  <div class="progress-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(p.task)} progress">
    <div class="progress-fill state-${state}" style="width:${pct}%"></div>
  </div>
  <div class="task-step">${esc(stepText)}${stepText && p.label ? ' — ' : ''}${esc(p.label)}${sub}</div>
  ${p.detail ? `<div class="task-detail">${esc(p.detail)}</div>` : ''}
  <div class="task-meta">${meta.join('')}</div>
  ${metrics}${log}${artifacts}${stateNote}
</div>`;
}
