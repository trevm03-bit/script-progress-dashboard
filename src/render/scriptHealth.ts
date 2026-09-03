// Script Health: the most recent run of every task and how stale it is.
import { DashboardData, Settings } from '../types';
import { healthRows } from '../logic/health';
import { formatDuration, relativeTime } from '../logic/time';
import { esc, icon, section, empty } from './html';

export function renderScriptHealth(data: DashboardData, settings: Settings, now: Date): string {
  const rows = healthRows(data.history, settings.staleHours, now);
  if (rows.length === 0) return section('scriptHealth', 'Script Health', empty('No runs recorded yet.'));

  const tr = rows
    .map(r => {
      const fCls = r.freshness === 'fresh' ? 'status-pass' : r.freshness === 'aging' ? 'status-warn' : 'status-stale';
      const fIcon = r.freshness === 'fresh' ? 'pass' : r.freshness === 'aging' ? 'clock' : 'warning';
      return `<tr>
  <td class="col-task" title="${esc(r.task)}">${esc(r.task)}</td>
  <td class="col-date">${esc(relativeTime(r.last.date, now))}</td>
  <td class="col-dur">${esc(formatDuration(r.last.elapsed))}</td>
  <td class="col-status ${r.last.success ? 'status-pass' : 'status-fail'}">${icon(r.last.success ? 'check' : 'error')}</td>
  <td class="col-fresh ${fCls}" title="${r.runs} runs, ${r.failures} failed">${icon(fIcon)} ${r.freshness}</td>
</tr>`;
    })
    .join('');

  const stale = rows.filter(r => r.freshness === 'stale').length;
  const title = stale ? `Script Health (${stale} stale)` : 'Script Health';
  const body = `<div class="table-wrap"><table>
  <thead><tr><th>Task</th><th>Last run</th><th>Duration</th><th>Result</th><th>Freshness</th></tr></thead>
  <tbody>${tr}</tbody>
</table></div>
<div class="muted small">Stale after ${settings.staleHours}h without a run.</div>`;
  return section('scriptHealth', title, body);
}
