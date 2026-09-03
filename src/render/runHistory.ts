// Run History: newest first, capped by settings. Column sorting is handled in the webview script.
import { DashboardData, Settings } from '../types';
import { dateTime, formatDuration, parseIso } from '../logic/time';
import { esc, icon, section, empty } from './html';

export function renderRunHistory(data: DashboardData, settings: Settings): string {
  const rows = data.history
    .slice()
    .sort((a, b) => (parseIso(b.date)?.getTime() ?? 0) - (parseIso(a.date)?.getTime() ?? 0))
    .slice(0, Math.max(1, settings.runHistoryMaxRows));

  if (rows.length === 0) return section('runHistory', 'Run History', empty('No runs recorded yet.'));

  const tr = rows
    .map(r => {
      const t = parseIso(r.date)?.getTime() ?? 0;
      return `<tr class="${r.success ? '' : 'row-failed'}">
  <td class="col-status ${r.success ? 'status-pass' : 'status-fail'}" data-sort="${r.success ? 1 : 0}">${icon(r.success ? 'check' : 'error')}</td>
  <td class="col-task" data-sort="${esc(r.task.toLowerCase())}" title="${esc(r.task)}">${esc(r.task)}</td>
  <td class="col-date" data-sort="${t}">${esc(dateTime(r.date))}</td>
  <td class="col-dur" data-sort="${r.elapsed}">${esc(formatDuration(r.elapsed))}</td>
  <td class="col-warn ${r.warnings ? 'status-warn' : ''}" data-sort="${r.warnings ?? 0}">${r.warnings ?? 0}</td>
  <td class="col-summary" title="${esc(r.summary)}">${esc(r.summary)}</td>
</tr>`;
    })
    .join('');

  const body = `<div class="table-wrap"><table class="sortable" data-table="history">
  <thead><tr>
    <th data-col="0" title="Sort">St</th>
    <th data-col="1" title="Sort">Task</th>
    <th data-col="2" title="Sort" class="sorted-desc">Date</th>
    <th data-col="3" title="Sort">Duration</th>
    <th data-col="4" title="Sort">Warn</th>
    <th>Summary</th>
  </tr></thead>
  <tbody>${tr}</tbody>
</table></div>
<div class="muted small">Showing ${rows.length} of ${data.history.length} runs</div>`;

  return section('runHistory', 'Run History', body);
}
