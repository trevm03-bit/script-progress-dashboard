// Quick Actions: buttons grouped by their 'group' setting. Clicking posts the button INDEX to
// the extension, which looks the command up in settings itself (the webview never sends command
// text, so a compromised page cannot run anything not in settings). A button that names its
// task shows that task's last result and is disabled while it runs.
import { DashboardData, Settings } from '../types';
import { parseIso, relativeTime, taskState } from '../logic/time';
import { esc, icon, section, empty, SectionOpts } from './html';

export function renderQuickActions(data: DashboardData, settings: Settings, now: Date, trusted: boolean, opts: SectionOpts): string {
  if (settings.buttons.length === 0) {
    return section('quickActions', 'Quick Actions', empty('No buttons configured yet.', { msg: 'settings', label: 'Add them in Settings', icon: 'settings-gear' }), opts);
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

  let body = '';
  for (const [group, indexes] of groups) {
    if (group) body += `<div class="btn-group-label">${esc(group)}</div>`;
    body += `<div class="btn-row">`;
    for (const index of indexes) {
      const b = settings.buttons[index];
      const taskKey = (b.task || '').toLowerCase();
      const isRunning = !!taskKey && [...running].some(t => t.startsWith(taskKey));
      const disabled = !trusted || (settings.quickActions.disableWhileRunning && isRunning);
      const last = taskKey ? [...lastByTask.entries()].filter(([k]) => k.startsWith(taskKey)).map(([, v]) => v).sort((a, b2) => (parseIso(b2.date)?.getTime() ?? 0) - (parseIso(a.date)?.getTime() ?? 0))[0] : undefined;
      const status = isRunning
        ? `<span class="btn-status">${icon('sync~spin')} running</span>`
        : last ? `<span class="btn-status ${last.success ? 'status-pass' : 'status-fail'}" title="Last run">${icon(last.success ? 'check' : 'error')} ${esc(relativeTime(last.date, now))}</span>` : '';
      body += `<div class="btn-cell"><button class="btn" data-action="${index}" title="${esc(b.command)}" ${disabled ? 'disabled' : ''}>${icon(b.icon)}<span>${esc(b.label)}</span>${b.confirm === false ? icon('zap', 'btn-hint') : ''}</button>${status}</div>`;
    }
    body += `</div>`;
  }
  if (!trusted) body += `<div class="muted small">${icon('shield')} Workspace is not trusted — buttons are disabled until you trust it.</div>`;
  const aside = settings.quickActions.runVia === 'task' ? `<span class="muted">${icon('tasklist')} as tasks</span>` : '';
  return section('quickActions', 'Quick Actions', body, { ...opts, aside });
}
