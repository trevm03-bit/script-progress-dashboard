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
    // 🔴 The LIVE tasks too. Looking only at history meant that during the first, still-running
    // run of a newly wired script this card said "Nothing is marked as needing action yet —
    // mark a finding with Progress.warn(…, actionable=True)" directly above a Warnings card
    // listing those exact findings. That is precisely the wiring-gap message this branch exists
    // to avoid getting wrong.
    const marked = (list: unknown) => Array.isArray(list) && list.some(w => w && typeof w === 'object' && (w as { actionable?: boolean }).actionable);
    const everMarked = data.history.some(r => marked(r.warningItems))
      || (data.tasks || []).some(t => marked(t.warnings));
    const body = everMarked
      ? empty('Nothing outstanding — the last successful run of every script reported no actionable findings.')
      : empty('Nothing is marked as needing action yet. Mark a finding with Progress.warn("…", actionable=True) and it will appear here.',
              { msg: 'walkthrough', label: 'Getting started', icon: 'book' });
    return section('pendingActions', 'Pending Actions', body, opts);
  }

  const byTask = new Map<string, typeof items>();
  for (const it of items) {
    const list = byTask.get(it.task);
    if (list) list.push(it); else byTask.set(it.task, [it]);
  }

  // Capped per script. 500 actionable findings from one run is a real shape - and rendered whole
  // it was an 85 KB card with no scroll container, burying every section under it.
  const PER_TASK = 25;
  // 🔴 Worst first. The cap used to take the first 25 in report order, so a run that reported
  // 25 info notes and then 5 errors showed the notes and hid every error - from the section
  // whose entire job is "the findings a script flagged as something a HUMAN has to do".
  const RANK: Record<string, number> = { error: 0, warn: 1, info: 2 };
  const worstFirst = (a: { severity?: string }, b: { severity?: string }) =>
    (RANK[String(a.severity ?? 'warn')] ?? 1) - (RANK[String(b.severity ?? 'warn')] ?? 1);
  let body = '';
  for (const [task, list] of byTask) {
    const shown = list.slice().sort(worstFirst).slice(0, PER_TASK);
    body += `<div class="pa-group"><div class="pa-task">${esc(task)} <span class="muted small">${esc(relativeTime(list[0].date, now))}</span></div>`;
    for (const it of shown) {
      const sev = it.severity === 'error' ? 'pa-error' : it.severity === 'info' ? 'pa-info' : 'pa-warn';
      const count = typeof it.count === 'number' ? `<span class="pa-count">${it.count}</span>` : '';
      const cat = it.category ? `<span class="pa-cat">${esc(it.category)}</span>` : '';
      body += `<div class="pa-item ${sev}" title="${esc(`Reported ${clockTime(it.time)} by ${it.task}`)}">${icon('circle-outline')}${count}<span class="pa-msg">${esc(it.msg)}</span>${cat}</div>`;
    }
    if (list.length > shown.length) {
      // Run History draws only the newest `maxRows` runs, so "open its row" was an instruction
      // that could not be followed for any script whose latest run is not among them. Say which.
      body += `<div class="muted small list-more">${icon('ellipsis')} ${list.length - shown.length} more from ${esc(task)}`
        + ` — the lower-severity ones. Expand that run in Run History for the full list; it shows the newest ${settings.runHistory.maxRows} runs.</div>`;
    }
    body += '</div>';
  }
  body += `<div class="muted small pa-foot">${icon('info')}<span>An item disappears when a later <b>successful</b> run of that script stops reporting it. A failed run never clears one.</span></div>`;

  return section('pendingActions', 'Pending Actions', body, {
    ...opts,
    aside: `<span class="status-warn">${items.length}</span>`,
  });
}
