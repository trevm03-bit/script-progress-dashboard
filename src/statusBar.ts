// The status-bar item: one line, always visible. Ticks once a second while a task runs so
// the elapsed time moves even between writes.
import * as vscode from 'vscode';
import { DashboardData, Settings } from './types';
import { clockTime, formatDuration, liveElapsed, liveEta, minutesSinceUpdate, taskState } from './logic/time';

export class StatusBarManager implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private timer: NodeJS.Timeout | undefined;
  private data: DashboardData | null = null;
  private settings: Settings | null = null;

  constructor() {
    this.item = vscode.window.createStatusBarItem('scriptProgress.status', vscode.StatusBarAlignment.Left, 100);
    this.item.name = 'Script Progress';
    this.item.command = 'scriptProgress.openPanel';
  }

  update(data: DashboardData, settings: Settings): void {
    this.data = data;
    this.settings = settings;
    this.render();
    // Tick only while something is running; otherwise nothing on the bar changes by itself.
    const running = data.progress && taskState(data.progress, settings.staleRunningMinutes, new Date()) === 'running';
    if (running && !this.timer) this.timer = setInterval(() => this.render(), 1000);
    if (!running && this.timer) { clearInterval(this.timer); this.timer = undefined; }
  }

  private render(): void {
    const data = this.data;
    const settings = this.settings;
    if (!data || !settings || !settings.statusBarEnabled) { this.item.hide(); return; }
    const p = data.progress;
    if (!p) { this.item.hide(); return; }

    const now = new Date();
    const state = taskState(p, settings.staleRunningMinutes, now);
    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${p.task}**\n\n`);
    this.item.backgroundColor = undefined;

    switch (state) {
      case 'running': {
        const step = p.totalSteps > 0 ? `${p.step}/${p.totalSteps} ` : '';
        const eta = liveEta(p, now);
        this.item.text = `$(sync~spin) ${step}${truncate(p.label, 28)} · ${formatDuration(liveElapsed(p, now))}`;
        md.appendMarkdown(`${p.label}${p.detail ? ` — ${p.detail}` : ''}\n\nElapsed ${formatDuration(liveElapsed(p, now))}${eta !== null ? ` · ~${formatDuration(eta)} left` : ''}`);
        if (p.warnings?.length) md.appendMarkdown(`\n\n$(warning) ${p.warnings.length} warning(s)`);
        break;
      }
      case 'stalled': {
        this.item.text = `$(warning) Stalled ${Math.round(minutesSinceUpdate(p, now))}m · ${truncate(p.task, 24)}`;
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        md.appendMarkdown(`Still marked running but not updated for ${Math.round(minutesSinceUpdate(p, now))} minutes.\n\nLast step: ${p.label}`);
        break;
      }
      case 'complete': {
        this.item.text = `$(check) ${truncate(p.task, 24)} ${clockTime(p.updatedAt)}`;
        md.appendMarkdown(`Completed at ${clockTime(p.updatedAt)} in ${formatDuration(p.elapsed)}${p.detail ? `\n\n${p.detail}` : ''}`);
        break;
      }
      case 'failed': {
        this.item.text = `$(error) FAILED ${truncate(p.task, 22)}`;
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        md.appendMarkdown(`Failed at ${clockTime(p.updatedAt)} after ${formatDuration(p.elapsed)}${p.detail ? `\n\n${p.detail}` : ''}`);
        break;
      }
      default:
        this.item.hide();
        return;
    }
    md.appendMarkdown('\n\n_Click to open the dashboard_');
    md.supportThemeIcons = true;
    this.item.tooltip = md;
    this.item.show();
  }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.item.dispose();
  }
}

function truncate(s: string, n: number): string {
  s = s || '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
