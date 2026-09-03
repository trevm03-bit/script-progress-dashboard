// Run History: newest first, capped by settings, with a search box + status chips (client-side
// filtering in dashboard.js), sortable columns, and a click-to-expand detail row.
import { DashboardData, RunRecord, Settings } from '../types';
import { dateTime, formatDuration, parseIso, clockTime } from '../logic/time';
import { esc, icon, section, empty, metricText, SectionOpts } from './html';

export function renderRunHistory(data: DashboardData, settings: Settings, opts: SectionOpts): string {
  const all = data.history
    .slice()
    .sort((a, b) => (parseIso(b.date)?.getTime() ?? 0) - (parseIso(a.date)?.getTime() ?? 0));
  const rows = all.slice(0, Math.max(1, settings.runHistory.maxRows));

  if (rows.length === 0) return section('runHistory', 'Run History', empty('No runs recorded yet.'), opts);

  const failed = all.filter(r => !r.success).length;
  const filters = settings.runHistory.filters ? `<div class="filters">
    <input type="search" class="filter-text" placeholder="Filter runs…" aria-label="Filter runs" spellcheck="false">
    <div class="chips-row" role="group" aria-label="Status filter">
      <button class="fchip active" data-filter="all">All <span class="n">${all.length}</span></button>
      <button class="fchip" data-filter="ok">OK <span class="n">${all.length - failed}</span></button>
      <button class="fchip" data-filter="fail">Failed <span class="n">${failed}</span></button>
      <button class="fchip" data-filter="warn">With warnings <span class="n">${all.filter(r => r.warnings).length}</span></button>
    </div>
  </div>` : '';

  const tr = rows.map(r => historyRow(r, settings)).join('');
  const body = `${filters}<div class="table-wrap"><table class="sortable history" data-table="history">
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
<div class="muted small table-foot"><span class="shown">Showing ${rows.length} of ${all.length} runs</span>${all.length > rows.length ? ` · raise <code>runHistory.maxRows</code> to see more` : ''} · <button class="link-btn" data-msg="exportCsv">${icon('export')}Export CSV</button></div>`;

  return section('runHistory', 'Run History', body, { ...opts, aside: failed ? `<span class="status-fail">${failed} failed</span>` : '' });
}

function historyRow(r: RunRecord, settings: Settings): string {
  const t = parseIso(r.date)?.getTime() ?? 0;
  const hay = `${r.task} ${r.summary ?? ''} ${Object.entries(r.metrics || {}).map(([k, v]) => `${k} ${v}`).join(' ')}`.toLowerCase();
  const kinds = [r.success ? 'ok' : 'fail', r.warnings ? 'warn' : ''].filter(Boolean).join(' ');
  const expandable = settings.runHistory.detail;
  const main = `<tr class="${r.success ? '' : 'row-failed'}${expandable ? ' expandable' : ''}" data-hay="${esc(hay)}" data-kinds="${kinds}">
  <td class="col-status ${r.success ? 'status-pass' : 'status-fail'}" data-sort="${r.success ? 1 : 0}">${icon(r.success ? 'check' : 'error')}</td>
  <td class="col-task" data-sort="${esc(r.task.toLowerCase())}" title="${esc(r.task)}">${expandable ? icon('chevron-right', 'row-chev') : ''}${esc(r.task)}</td>
  <td class="col-date" data-sort="${t}">${esc(dateTime(r.date))}</td>
  <td class="col-dur" data-sort="${Number(r.elapsed) || 0}">${esc(formatDuration(Number(r.elapsed) || 0))}</td>
  <td class="col-warn ${r.warnings ? 'status-warn' : ''}" data-sort="${Number(r.warnings) || 0}">${Number(r.warnings) || 0}</td>
  <td class="col-summary" title="${esc(r.summary)}">${esc(r.summary)}</td>
</tr>`;
  if (!expandable) return main;

  const parts: string[] = [];
  if (r.metrics && Object.keys(r.metrics).length) parts.push(`<div class="detail-block"><div class="detail-h">Metrics</div><div class="chips">${Object.entries(r.metrics).map(([k, v]) => `<span class="chip"><span class="chip-k">${esc(k)}</span><span class="chip-v">${esc(metricText(v))}</span></span>`).join('')}</div></div>`);
  if (r.warningItems && r.warningItems.length) parts.push(`<div class="detail-block"><div class="detail-h">Warnings</div>${r.warningItems.map(w => `<div class="warning-card"><span class="warning-time">${esc(clockTime(w.time))}</span> ${esc(w.msg)}</div>`).join('')}</div>`);
  if (r.accessed && r.accessed.length) parts.push(`<div class="detail-block"><div class="detail-h">Touched</div><div class="chips">${r.accessed.map(id => { const [kind, ...rest] = id.split(':'); return `<span class="chip chip-${esc(kind)}"><span class="chip-k">${esc(kind)}</span><span class="chip-v">${esc(rest.join(':'))}</span></span>`; }).join('')}</div></div>`);
  if (r.artifacts && r.artifacts.length) parts.push(`<div class="detail-block"><div class="detail-h">Artifacts</div><div class="artifacts">${r.artifacts.map(a => `<button class="link-btn" data-open="${esc(a)}" title="${esc(a)}">${icon('file')}${esc(a.split(/[\\/]/).pop() || a)}</button>`).join('')}</div></div>`);
  const ids = [r.runId ? `run ${r.runId}` : '', r.startedAt ? `started ${dateTime(r.startedAt)}` : ''].filter(Boolean).join(' · ');
  if (ids) parts.push(`<div class="detail-block muted small mono">${esc(ids)}</div>`);
  if (!parts.length) parts.push(`<div class="detail-block muted small">No extra detail recorded for this run (older reporter).</div>`);
  return main + `<tr class="detail" hidden><td colspan="6"><div class="detail-wrap">${parts.join('')}</div></td></tr>`;
}
