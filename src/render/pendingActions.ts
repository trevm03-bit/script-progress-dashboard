// Pending Actions: the findings a script flagged as something a HUMAN has to do.
//
// Derived from each task's most recent successful run — nothing is stored, so nothing here can
// disagree with what actually happened. An item leaves this list exactly when a later successful
// run of that task stops reporting it. See logic/compliance.ts for why a failed run may not clear.
import { DashboardData, Settings } from '../types';
import { pendingActions } from '../logic/compliance';
import { relativeTime, clockTime } from '../logic/time';
import { esc, icon, section, empty, SectionOpts } from './html';

export function renderPendingActions(data: DashboardData, settings: Settings, now: Date, opts: SectionOpts): string {
  const items = pendingActions(data.history, now, settings.pendingActions.maxAgeDays);
  if (!items.length) {
    // Distinguish "nothing outstanding" from "nothing ever marked actionable" — the second is a
    // wiring gap, and telling someone their to-do list is empty when nothing can reach it is a
    // small lie that takes a long time to notice.
    const everMarked = data.history.some(r => (r.warningItems ?? []).some(w => w?.actionable));
    const body = everMarked
      ? empty('Nothing outstanding — the last successful run of every script reported no actionable findings.')
      : empty('No script marks findings as actionable yet. Add actionable=True to a warning your scripts raise: p.warn("…", actionable=True).');
    return section('pendingActions', 'Pending Actions', body, opts);
  }

  const byTask = new Map<string, typeof items>();
  for (const it of items) {
    const list = byTask.get(it.task);
    if (list) list.push(it); else byTask.set(it.task, [it]);
  }

  let body = '';
  for (const [task, list] of byTask) {
    body += `<div class="pa-group"><div class="pa-task">${esc(task)} <span class="muted small">${esc(relativeTime(list[0].date, now))}</span></div>`;
    for (const it of list) {
      const sev = it.severity === 'error' ? 'pa-error' : it.severity === 'info' ? 'pa-info' : 'pa-warn';
      const count = typeof it.count === 'number' ? `<span class="pa-count">${it.count}</span>` : '';
      const cat = it.category ? `<span class="pa-cat">${esc(it.category)}</span>` : '';
      body += `<div class="pa-item ${sev}" title="${esc(`Reported ${clockTime(it.time)} by ${it.task}`)}">${icon('circle-outline')}${count}<span class="pa-msg">${esc(it.msg)}</span>${cat}</div>`;
    }
    body += '</div>';
  }
  body += `<div class="muted small pa-foot">${icon('info')}An item disappears when a later <b>successful</b> run of that script stops reporting it. A failed run never clears one.</div>`;

  return section('pendingActions', 'Pending Actions', body, {
    ...opts,
    aside: `<span class="status-warn">${items.length}</span>`,
  });
}
