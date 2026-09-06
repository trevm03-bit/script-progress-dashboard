"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderActiveTask = renderActiveTask;
const time_1 = require("../logic/time");
const html_1 = require("./html");
const anomaly_1 = require("../logic/anomaly");
const STATE_ICON = {
    running: 'sync~spin', stalled: 'warning', exited: 'debug-disconnect', complete: 'check', failed: 'error', idle: 'circle-outline',
};
const STATE_LABEL = {
    running: 'Running', stalled: 'Stalled', exited: 'Exited', complete: 'Complete', failed: 'Failed', idle: 'Idle',
};
function renderActiveTask(data, settings, now, opts) {
    if (!data.tasks.length) {
        const hint = data.logsDirExists
            ? 'No progress.json yet. It appears the first time a script reports.'
            : `Logs folder not found: ${data.logsDir}`;
        return (0, html_1.section)('activeTask', 'Active Task', (0, html_1.empty)(hint, { msg: 'simulate', label: 'Simulate a demo run', icon: 'beaker' }), opts);
    }
    const running = data.tasks.filter(t => t.status === 'running');
    const cards = running.length ? running : [data.tasks[0]];
    const body = cards.map(t => taskCard(t, data, settings, now)).join('');
    const title = running.length > 1 ? `Active Tasks (${running.length})` : 'Active Task';
    return (0, html_1.section)('activeTask', title, body, { ...opts, cls: `task-${(0, time_1.taskState)(cards[0], settings.staleRunningMinutes, now, data.overlays)}` });
}
function taskCard(p, data, settings, now) {
    const state = (0, time_1.taskState)(p, settings.staleRunningMinutes, now, data.overlays);
    const pct = (0, time_1.percent)(p.step, p.totalSteps, p.substep);
    const elapsed = (0, time_1.liveElapsed)(p, now);
    const eta = (0, time_1.liveEta)(p, now);
    const stepText = p.totalSteps > 0 ? `Step ${p.step}/${p.totalSteps}` : '';
    const sub = typeof p.substep === 'number' && p.substep > 0 && p.substep < 1 && state === 'running' ? ` <span class="muted">(${Math.round(p.substep * 100)}%)</span>` : '';
    let stateNote = '';
    if (state === 'stalled')
        stateNote = `<div class="state-note status-warn">${(0, html_1.icon)('warning')} No update for ${Math.round((0, time_1.minutesSinceUpdate)(p, now))} min — the script may have stopped without reporting.</div>`;
    if (state === 'exited') {
        const o = (0, time_1.exitOverlayFor)(p, data.overlays);
        stateNote = `<div class="state-note status-fail">${(0, html_1.icon)('debug-disconnect')} The process exited with code ${o?.exitCode ?? '?'} while the script still reported "running".</div>`;
    }
    const sla = (0, anomaly_1.slaFor)(p.task, settings.processes);
    const pastSla = typeof sla === 'number' && elapsed > sla * 60 && (state === 'running' || state === 'stalled');
    if (pastSla && !stateNote)
        stateNote = `<div class="state-note status-fail">${(0, html_1.icon)('alert')} Over the ${(0, html_1.esc)((0, time_1.formatDuration)(sla * 60))} limit set for this process — ${(0, html_1.esc)((0, time_1.formatDuration)(elapsed - sla * 60))} past it.</div>`;
    const meta = [];
    meta.push(`<span title="Elapsed${typeof sla === 'number' ? ` (limit ${(0, time_1.formatDuration)(sla * 60)})` : ''}" class="${pastSla ? 'status-fail' : ''}">${(0, html_1.icon)('watch')} ${(0, html_1.esc)((0, time_1.formatDuration)(elapsed))}${typeof sla === 'number' ? `<span class="muted"> / ${(0, html_1.esc)((0, time_1.formatDuration)(sla * 60))}</span>` : ''}</span>`);
    if (state === 'running' && eta !== null)
        meta.push(`<span title="Estimated remaining, from prior runs">${(0, html_1.icon)('history')} ~${(0, html_1.esc)((0, time_1.formatDuration)(eta))} left</span>`);
    const warnCount = Math.max(p.warningsTotal ?? 0, p.warnings?.length ?? 0);
    if (warnCount)
        meta.push(`<span class="status-warn" title="Warnings this run">${(0, html_1.icon)('warning')} ${warnCount}</span>`);
    if (p.startedAt)
        meta.push(`<span class="muted" title="Started">${(0, html_1.icon)('play')} ${(0, html_1.esc)((0, time_1.clockTime)(p.startedAt))}</span>`);
    if (p.runId)
        meta.push(`<span class="muted mono" title="Run id">${(0, html_1.esc)(p.runId)}</span>`);
    const metrics = settings.activeTask.showMetrics && p.metrics && Object.keys(p.metrics).length
        ? `<div class="chips">${Object.entries(p.metrics).map(([k, v]) => (0, html_1.chip)(k, (0, html_1.metricText)(v))).join('')}</div>` : '';
    const log = settings.activeTask.showLog && p.log && p.log.length
        ? `<div class="log-tail">${p.log.slice(-settings.activeTask.logLines).map(l => `<div class="log-line"><span class="log-time">${(0, html_1.esc)((0, time_1.clockTime)(l.time))}</span>${(0, html_1.esc)(l.msg)}</div>`).join('')}</div>` : '';
    const artifacts = settings.activeTask.showArtifacts && p.artifacts && p.artifacts.length
        ? `<div class="artifacts">${p.artifacts.map(a => `<button class="link-btn" data-open="${(0, html_1.esc)(a)}" title="${(0, html_1.esc)(a)}">${(0, html_1.icon)('file')}${(0, html_1.esc)(a.split(/[\\/]/).pop() || a)}</button>`).join('')}</div>` : '';
    return `<div class="task-card state-${state}">
  <div class="task-head">
    <span class="task-state state-${state}">${(0, html_1.icon)(STATE_ICON[state])} ${STATE_LABEL[state]}</span>
    <span class="task-name" title="${(0, html_1.esc)(p.task)}">${(0, html_1.esc)(p.task)}</span>
  </div>
  <div class="progress-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${(0, html_1.esc)(p.task)} progress">
    <div class="progress-fill state-${state}" style="width:${pct}%"></div>
  </div>
  <div class="task-step">${(0, html_1.esc)(stepText)}${stepText && p.label ? ' — ' : ''}${(0, html_1.esc)(p.label)}${sub}</div>
  ${p.detail ? `<div class="task-detail">${(0, html_1.esc)(p.detail)}</div>` : ''}
  <div class="task-meta">${meta.join('')}</div>
  ${metrics}${log}${artifacts}${stateNote}
</div>`;
}
//# sourceMappingURL=activeTask.js.map