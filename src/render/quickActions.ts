// Quick Actions: buttons grouped by their 'group' setting. Clicking posts the button INDEX to
// the extension, which looks the command up in settings itself (the webview never sends command
// text, so a compromised page cannot run anything not in settings). A button that names its
// task shows that task's last result and is disabled while it runs.
import { DashboardData, Settings } from '../types';
import { parseIso, relativeTime, taskMatches, taskState } from '../logic/time';
import { esc, icon, section, empty, problemList, SectionOpts } from './html';
import { problemsFor } from '../logic/validate';
import { buttonEnabled } from '../logic/buttons';

export function renderQuickActions(data: DashboardData, settings: Settings, now: Date, trusted: boolean, opts: SectionOpts): string {
  const problems = problemsFor(settings.problems, 'quickActions');
  if (settings.buttons.length === 0) {
    // Distinguish "not set up" from "set up wrongly" — they need opposite responses.
    const body = problems.length
      ? problemList(problems) + empty('No usable buttons, so nothing is shown here.')
      : empty('No buttons configured yet.', { msg: 'settings', label: 'Add them in Settings', icon: 'settings-gear' });
    return section('quickActions', 'Quick Actions', body, opts);
  }
  const running = new Set(data.tasks.filter(t => taskState(t, settings.staleRunningMinutes, now, data.overlays) === 'running').map(t => t.task.toLowerCase()));
  const lastByTask = new Map<string, { success: boolean; date: string }>();
  for (const r of data.history) {
    const k = r.task.toLowerCase();
    const cur = lastByTask.get(k);
    if (!cur || (parseIso(r.date)?.getTime() ?? 0) > (parseIso(cur.date)?.getTime() ?? 0)) lastByTask.set(k, { success: r.success, date: r.date });
  }

  const groups = new Map<string, number[]>();
  settings.buttons.forEach((b, index) => {
    const g = b.group || '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(index);
  });

  let body = problemList(problems);
  for (const [group, indexes] of groups) {
    if (group) body += `<div class="btn-group-label">${esc(group)}</div>`;
    body += `<div class="btn-row">`;
    for (const index of indexes) {
      const b = settings.buttons[index];
      const taskKey = b.task || '';
      const isRunning = !!taskKey && [...running].some(t => taskMatches(t, taskKey));
      // A button can also be pointless right now — a "fix" with nothing to fix. Disabled with
      // the reason, never hidden.
      const verdict = buttonEnabled(b.enableWhen, b.task, data.history);
      const disabled = !trusted || (settings.quickActions.disableWhileRunning && isRunning) || !verdict.enabled;
      const last = taskKey ? [...lastByTask.entries()].filter(([k]) => taskMatches(k, taskKey)).map(([, v]) => v).sort((a, b2) => (parseIso(b2.date)?.getTime() ?? 0) - (parseIso(a.date)?.getTime() ?? 0))[0] : undefined;
      const status = isRunning
        ? `<span class="btn-status">${icon('sync~spin')} running</span>`
        : last ? `<span class="btn-status ${last.success ? 'status-pass' : 'status-fail'}" title="Last run">${icon(last.success ? 'check' : 'error')} ${esc(relativeTime(last.date, now))}</span>` : '';
      const why = !verdict.enabled && trusted && !isRunning ? verdict.reason : '';
      const tip = why ? `${b.command}

Not needed right now: ${why}` : b.command;
      body += `<div class="btn-cell"><button class="btn" data-action="${index}" title="${esc(tip)}" ${disabled ? 'disabled' : ''}>${icon(b.icon)}<span>${esc(b.label)}</span>${b.confirm === false ? icon('zap', 'btn-hint') : ''}</button>${why ? `<span class="btn-status muted" title="${esc(why)}">${icon('info')} not needed</span>` : status}</div>`;
    }
    body += `</div>`;
  }
  if (!trusted) body += `<div class="muted small">${icon('shield')} Workspace is not trusted — buttons are disabled until you trust it.</div>`;
  const aside = settings.quickActions.runVia === 'task' ? `<span class="muted">${icon('tasklist')} as tasks</span>` : '';
  return section('quickActions', 'Quick Actions', body, { ...opts, aside });
}
