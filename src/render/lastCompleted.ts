// Last Completed: status / duration / warnings cards, then the metrics the script reported,
// then its name, summary and artifacts.
import { DashboardData, Settings } from '../types';
import { formatDuration, parseIso, relativeTime } from '../logic/time';
import { esc, icon, section, empty, metricText, SectionOpts } from './html';

export function renderLastCompleted(data: DashboardData, settings: Settings, now: Date, opts: SectionOpts): string {
  const sorted = data.history
    .slice()
    .sort((a, b) => (parseIso(b.date)?.getTime() ?? 0) - (parseIso(a.date)?.getTime() ?? 0));
  const last = sorted[0];
  if (!last) return section('lastCompleted', 'Last Completed', empty('No completed runs yet.'), opts);

  const statusCls = last.success ? 'status-pass' : 'status-fail';
  const statusIcon = last.success ? 'check' : 'error';
  const statusText = last.success ? 'OK' : 'FAILED';

  const metricCards = last.metrics && Object.keys(last.metrics).length
    ? Object.entries(last.metrics).slice(0, 8).map(([k, v]) => `<div class="metric metric-user"><div class="metric-value">${esc(metricText(v))}</div><div class="metric-label" title="${esc(k)}">${esc(k)}</div></div>`).join('')
    : '';
  const artifacts = settings.activeTask.showArtifacts && last.artifacts && last.artifacts.length
    ? `<div class="artifacts">${last.artifacts.map(a => `<button class="link-btn" data-open="${esc(a)}" title="${esc(a)}">${icon('file')}${esc(a.split(/[\\/]/).pop() || a)}</button>`).join('')}</div>` : '';

  const body = `
  <div class="metrics">
    <div class="metric"><div class="metric-value ${statusCls}">${icon(statusIcon)} ${statusText}</div><div class="metric-label">Status</div></div>
    <div class="metric"><div class="metric-value">${esc(formatDuration(last.elapsed))}</div><div class="metric-label">Duration</div></div>
    <div class="metric"><div class="metric-value ${last.warnings ? 'status-warn' : ''}">${last.warnings ?? 0}</div><div class="metric-label">Warnings</div></div>
    ${metricCards}
  </div>
  <div class="last-name" title="${esc(last.task)}">${esc(last.task)} <span class="muted">· ${esc(relativeTime(last.date, now))}</span></div>
  ${last.summary ? `<div class="last-summary">${esc(last.summary)}</div>` : ''}
  ${artifacts}`;

  return section('lastCompleted', 'Last Completed', body, opts);
}
