// Quick Actions: buttons grouped by their 'group' setting. Clicking posts the button INDEX
// to the extension, which looks the command up in settings itself (the webview never sends
// command text, so a compromised page cannot run anything not in settings).
import { Settings } from '../types';
import { esc, icon, section, empty } from './html';

export function renderQuickActions(settings: Settings, trusted: boolean): string {
  if (settings.buttons.length === 0) {
    return section('quickActions', 'Quick Actions', empty('No buttons configured. Add them under scriptProgress.quickActions.buttons.'));
  }
  const groups = new Map<string, { index: number; label: string; icon?: string; confirm: boolean; command: string }[]>();
  settings.buttons.forEach((b, index) => {
    const g = b.group || '';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push({ index, label: b.label, icon: b.icon, confirm: b.confirm !== false, command: b.command });
  });

  let body = '';
  for (const [group, buttons] of groups) {
    if (group) body += `<div class="btn-group-label">${esc(group)}</div>`;
    body += `<div class="btn-row">`;
    for (const b of buttons) {
      body += `<button class="btn" data-action="${b.index}" title="${esc(b.command)}" ${trusted ? '' : 'disabled'}>${icon(b.icon)}<span>${esc(b.label)}</span>${b.confirm ? '' : icon('zap', 'btn-hint')}</button>`;
    }
    body += `</div>`;
  }
  if (!trusted) body += `<div class="muted small">${icon('shield')} Workspace is not trusted — buttons are disabled until you trust it.</div>`;
  return section('quickActions', 'Quick Actions', body);
}
