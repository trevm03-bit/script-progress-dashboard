// The status-bar item: one line, always visible. Ticks once a second while a task runs so
// the elapsed time moves even between writes. Click → a menu of actions (or the dashboard).
import * as vscode from 'vscode';
import { DashboardData, Settings, TaskState } from './types';
import { clockTime, formatDuration, liveElapsed, liveEta, minutesSinceUpdate, percent, relativeTime, taskState } from './logic/time';

export class StatusBarManager implements vscode.Disposable {
  private item: vscode.StatusBarItem;
  private timer: NodeJS.Timeout | undefined;
  private data: DashboardData | null = null;
  private settings: Settings | null = null;

  constructor() {
    this.item = vscode.window.createStatusBarItem('scriptProgress.status', vscode.StatusBarAlignment.Left, 100);
    this.item.name = 'Script Progress';
  }

  update(data: DashboardData, settings: Settings): void {
    this.data = data;
    this.settings = settings;
    this.item.command = settings.statusBar.clickAction === 'menu' ? 'scriptProgress.statusMenu' : 'scriptProgress.openPanel';
    this.render();
    const now = new Date();
    // Only tick when there is a visible clock to advance. A disabled status bar was still running
    // a one-second timer whose render() returned immediately.
    const running = settings.statusBar.enabled
      && data.tasks.some(t => taskState(t, settings.staleRunningMinutes, now, data.overlays) === 'running');
    if (running && !this.timer) this.timer = setInterval(() => this.render(), 1000);
    if (!running && this.timer) { clearInterval(this.timer); this.timer = undefined; }
  }

  /**
   * Neutralise Markdown in text that came out of a file. Task names, labels and details are
   * workspace-controlled, and every other surface routes them through esc(); this one built a
   * MarkdownString by interpolation, so a name containing *, _, [](), # or a blank line rewrote
   * the tooltip's layout - and an image link would have been an outbound request from a product
   * whose headline promise is that nothing leaves the machine.
   */
  private static mdEsc(value: unknown): string {
    return String(value ?? '')
      .replace(/[\\`*_{}\[\]()#+\-.!|<>~$]/g, m => '\\' + m)
      // 🔴 A LONE \r counts. markdown-it normalises /\r\n?|\n/ to a newline, so \r\r was still a
      // paragraph break - and a script piping a subprocess's \r-based progress line into a
      // detail hits this with no malice at all, while deliberate content could place an
      // authoritative-looking sentence of its own in the tooltip.
      .replace(/[\r\n]+/g, ' ');
  }

  /**
   * Text for the status bar ITEM, as opposed to its tooltip.
   *
   * 🔴 StatusBarItem.text renders `$(icon-name)` as a codicon - this file depends on that for
   * $(sync~spin), $(error) and $(warning) - and progress.json is an open contract that other
   * producers write. A task name or step label carrying `$(check)` therefore put a green tick
   * beside the word FAILED, on the one line of this extension's UI that has to be trustworthy
   * at a glance. mdEsc guarded the tooltip and nothing guarded this.
   */
  private static barText(value: unknown): string {
    return String(value ?? '').replace(/\$\(/g, '$ (').replace(/[\r\n]+/g, ' ');
  }

  private render(): void {
    const E = StatusBarManager.mdEsc;
    const T = StatusBarManager.barText;
    const data = this.data;
    const settings = this.settings;
    if (!data || !settings || !settings.statusBar.enabled) { this.item.hide(); return; }
    const now = new Date();
    const states = data.tasks.map(t => ({ t, s: taskState(t, settings.staleRunningMinutes, now, data.overlays) }));
    const running = states.filter(x => x.s === 'running');
    const stalled = states.filter(x => x.s === 'stalled' || x.s === 'exited');
    const md = new vscode.MarkdownString();
    md.supportThemeIcons = true;
    this.item.backgroundColor = undefined;

    if (running.length) {
      const p = running[0].t;
      const step = p.totalSteps > 0 ? `${p.step}/${p.totalSteps} ` : '';
      const more = running.length > 1 ? ` +${running.length - 1}` : '';
      const pct = p.totalSteps > 0 ? ` ${percent(p.step, p.totalSteps, p.substep)}%` : '';
      this.item.text = `$(sync~spin) ${step}${T(truncate(p.label, 28))} · ${formatDuration(liveElapsed(p, now))}${pct}${more}`;
      for (const { t } of running) {
        const eta = liveEta(t, now);
        md.appendMarkdown(`**${E(t.task)}** — ${E(t.label)}${t.detail ? ` — ${E(t.detail)}` : ''}\n\nElapsed ${formatDuration(liveElapsed(t, now))}${eta !== null ? ` · ~${formatDuration(eta)} left` : ''}${t.warnings?.length ? ` · $(warning) ${t.warnings.length}` : ''}\n\n`);
      }
      if (stalled.length) md.appendMarkdown(`$(warning) ${stalled.length} stalled\n\n`);
    } else if (stalled.length) {
      const p = stalled[0].t;
      const label = stalled[0].s === 'exited' ? 'Exited' : 'Stalled';
      this.item.text = `$(warning) ${label} ${Math.round(minutesSinceUpdate(p, now))}m · ${T(truncate(p.task, 24))}`;
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      md.appendMarkdown(`**${E(p.task)}** still marked running but ${stalled[0].s === 'exited' ? 'its process exited' : `not updated for ${Math.round(minutesSinceUpdate(p, now))} minutes`}.\n\nLast step: ${E(p.label)}\n\n`);
    } else {
      if (settings.statusBar.idleMode === 'hidden') { this.item.hide(); return; }
      if (!data.progress) {
        // Nothing has ever reported. Say so rather than showing a bare icon that could equally
        // mean "extension broken" — the tooltip is the only place to answer "is this watching?".
        this.item.text = '$(pulse) Script Progress';
        md.appendMarkdown(`No runs recorded yet.

Watching \`${this.logsHint().replace(/`/g, "'")}\` for progress files. Run **Script Progress: Simulate a Demo Run** to see it work.

`);
        md.appendMarkdown(settings.statusBar.clickAction === 'menu' ? '_Click for actions_' : '_Click to open the dashboard_');
        this.item.tooltip = md;
        this.item.show();
        return;
      }
      const p = data.progress;
      const state: TaskState = taskState(p, settings.staleRunningMinutes, now, data.overlays);
      if (state === 'failed') {
        this.item.text = `$(error) FAILED ${T(truncate(p.task, 22))}`;
        this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        md.appendMarkdown(`**${E(p.task)}** failed at ${clockTime(p.updatedAt)} after ${formatDuration(p.elapsed)}${p.detail ? `\n\n${E(p.detail)}` : ''}\n\n`);
      } else {
        this.item.text = `$(check) ${T(truncate(p.task, 24))} ${clockTime(p.updatedAt)}`;
        md.appendMarkdown(`**${E(p.task)}** completed at ${clockTime(p.updatedAt)} in ${formatDuration(p.elapsed)}${p.detail ? `\n\n${E(p.detail)}` : ''}\n\n`);
      }
    }
    md.appendMarkdown(settings.statusBar.clickAction === 'menu' ? '_Click for actions_' : '_Click to open the dashboard_');
    this.item.tooltip = md;
    this.item.show();
  }

  /** Where the reader is looking, for the "nothing yet" tooltip. Set by the extension. */
  logsDir = '';
  private logsHint(): string { return this.logsDir || 'the configured logs folder'; }

  dispose(): void {
    if (this.timer) clearInterval(this.timer);
    this.item.dispose();
  }
}

function truncate(s: string, n: number): string {
  s = s || '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
