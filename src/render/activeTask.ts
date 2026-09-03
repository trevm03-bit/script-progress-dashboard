// Active Task: progress bar, step label, elapsed, ETA, and the state icon.
import { DashboardData, Settings, TaskState } from '../types';
import { formatDuration, liveElapsed, liveEta, minutesSinceUpdate, percent, taskState } from '../logic/time';
import { esc, icon, section, empty } from './html';

const STATE_ICON: Record<TaskState, string> = {
  running: 'sync~spin',
  stalled: 'warning',
  complete: 'check',
  failed: 'error',
  idle: 'circle-outline',
};

const STATE_LABEL: Record<TaskState, string> = {
  running: 'Running',
  stalled: 'Stalled',
  complete: 'Complete',
  failed: 'Failed',
  idle: 'Idle',
};

export function renderActiveTask(data: DashboardData, settings: Settings, now: Date): string {
  const p = data.progress;
  if (!p) {
    const hint = data.logsDirExists
      ? 'No progress.json yet. It appears the first time a script reports.'
      : `Logs folder not found: ${data.logsDir}`;
    return section('activeTask', 'Active Task', empty(hint));
  }

  const state = taskState(p, settings.staleRunningMinutes, now);
  const pct = percent(p.step, p.totalSteps);
  const elapsed = liveElapsed(p, now);
  const eta = liveEta(p, now);
  const stepText = p.totalSteps > 0 ? `Step ${p.step}/${p.totalSteps}` : '';

  let stateNote = '';
  if (state === 'stalled') {
    stateNote = `<div class="state-note status-warn">${icon('warning')} No update for ${Math.round(minutesSinceUpdate(p, now))} min — the script may have stopped without reporting.</div>`;
  }

  const meta: string[] = [];
  meta.push(`<span title="Elapsed">${icon('watch')} ${esc(formatDuration(elapsed))}</span>`);
  if (state === 'running' && eta !== null) meta.push(`<span title="Estimated remaining, from prior runs">${icon('history')} ~${esc(formatDuration(eta))} left</span>`);
  if (p.warnings && p.warnings.length) meta.push(`<span class="status-warn" title="Warnings this run">${icon('warning')} ${p.warnings.length}</span>`);

  const body = `
  <div class="task-head">
    <span class="task-state state-${state}">${icon(STATE_ICON[state])} ${STATE_LABEL[state]}</span>
    <span class="task-name" title="${esc(p.task)}">${esc(p.task)}</span>
  </div>
  <div class="progress-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
    <div class="progress-fill state-${state}" style="width:${pct}%"></div>
  </div>
  <div class="task-step">${esc(stepText)}${stepText && p.label ? ' — ' : ''}${esc(p.label)}</div>
  ${p.detail ? `<div class="task-detail">${esc(p.detail)}</div>` : ''}
  <div class="task-meta">${meta.join('')}</div>
  ${stateNote}`;

  return section('activeTask', 'Active Task', body, `task-${state}`);
}
