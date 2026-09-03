// Last Completed: three metric cards for the most recent run, plus its name and summary.
import { DashboardData } from '../types';
import { formatDuration, parseIso, relativeTime } from '../logic/time';
import { esc, icon, section, empty } from './html';

export function renderLastCompleted(data: DashboardData, now: Date): string {
  const sorted = data.history
    .slice()
    .sort((a, b) => (parseIso(b.date)?.getTime() ?? 0) - (parseIso(a.date)?.getTime() ?? 0));
  const last = sorted[0];
  if (!last) return section('lastCompleted', 'Last Completed', empty('No completed runs yet.'));

  const statusCls = last.success ? 'status-pass' : 'status-fail';
  const statusIcon = last.success ? 'check' : 'error';
  const statusText = last.success ? 'OK' : 'FAILED';

  const body = `
  <div class="metrics">
    <div class="metric"><div class="metric-value ${statusCls}">${icon(statusIcon)} ${statusText}</div><div class="metric-label">Status</div></div>
    <div class="metric"><div class="metric-value">${esc(formatDuration(last.elapsed))}</div><div class="metric-label">Duration</div></div>
    <div class="metric"><div class="metric-value ${last.warnings ? 'status-warn' : ''}">${last.warnings ?? 0}</div><div class="metric-label">Warnings</div></div>
  </div>
  <div class="last-name" title="${esc(last.task)}">${esc(last.task)} <span class="muted">· ${esc(relativeTime(last.date, now))}</span></div>
  ${last.summary ? `<div class="last-summary">${esc(last.summary)}</div>` : ''}`;

  return section('lastCompleted', 'Last Completed', body);
}
