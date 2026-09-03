"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderActiveTask = renderActiveTask;
const time_1 = require("../logic/time");
const html_1 = require("./html");
const STATE_ICON = {
    running: 'sync~spin',
    stalled: 'warning',
    complete: 'check',
    failed: 'error',
    idle: 'circle-outline',
};
const STATE_LABEL = {
    running: 'Running',
    stalled: 'Stalled',
    complete: 'Complete',
    failed: 'Failed',
    idle: 'Idle',
};
function renderActiveTask(data, settings, now) {
    const p = data.progress;
    if (!p) {
        const hint = data.logsDirExists
            ? 'No progress.json yet. It appears the first time a script reports.'
            : `Logs folder not found: ${data.logsDir}`;
        return (0, html_1.section)('activeTask', 'Active Task', (0, html_1.empty)(hint));
    }
    const state = (0, time_1.taskState)(p, settings.staleRunningMinutes, now);
    const pct = (0, time_1.percent)(p.step, p.totalSteps);
    const elapsed = (0, time_1.liveElapsed)(p, now);
    const eta = (0, time_1.liveEta)(p, now);
    const stepText = p.totalSteps > 0 ? `Step ${p.step}/${p.totalSteps}` : '';
    let stateNote = '';
    if (state === 'stalled') {
        stateNote = `<div class="state-note status-warn">${(0, html_1.icon)('warning')} No update for ${Math.round((0, time_1.minutesSinceUpdate)(p, now))} min — the script may have stopped without reporting.</div>`;
    }
    const meta = [];
    meta.push(`<span title="Elapsed">${(0, html_1.icon)('watch')} ${(0, html_1.esc)((0, time_1.formatDuration)(elapsed))}</span>`);
    if (state === 'running' && eta !== null)
        meta.push(`<span title="Estimated remaining, from prior runs">${(0, html_1.icon)('history')} ~${(0, html_1.esc)((0, time_1.formatDuration)(eta))} left</span>`);
    if (p.warnings && p.warnings.length)
        meta.push(`<span class="status-warn" title="Warnings this run">${(0, html_1.icon)('warning')} ${p.warnings.length}</span>`);
    const body = `
  <div class="task-head">
    <span class="task-state state-${state}">${(0, html_1.icon)(STATE_ICON[state])} ${STATE_LABEL[state]}</span>
    <span class="task-name" title="${(0, html_1.esc)(p.task)}">${(0, html_1.esc)(p.task)}</span>
  </div>
  <div class="progress-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
    <div class="progress-fill state-${state}" style="width:${pct}%"></div>
  </div>
  <div class="task-step">${(0, html_1.esc)(stepText)}${stepText && p.label ? ' — ' : ''}${(0, html_1.esc)(p.label)}</div>
  ${p.detail ? `<div class="task-detail">${(0, html_1.esc)(p.detail)}</div>` : ''}
  <div class="task-meta">${meta.join('')}</div>
  ${stateNote}`;
    return (0, html_1.section)('activeTask', 'Active Task', body, `task-${state}`);
}
//# sourceMappingURL=activeTask.js.map