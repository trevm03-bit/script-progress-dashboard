// Turns state TRANSITIONS into VS Code notifications, and optionally mirrors the running task
// into a native progress notification. Nothing fires for state that already existed when the
// extension activated — only for changes seen while it was watching.
import * as vscode from 'vscode';
import { DashboardData, ProgressData, Settings, TaskState } from './types';
import { formatDuration, percent, taskState, liveElapsed } from './logic/time';
import { durationVerdict, slaFor } from './logic/anomaly';
import { calendarRows, dueReminders } from './logic/calendar';
import { writeEvent } from './eventFile';

interface Seen {
  state: TaskState;
  warnings: number;
  updatedAt: string;
  /** Already told the user this run is over its limit. */
  slaWarned?: boolean;
}

export class Notifier implements vscode.Disposable {
  private seen = new Map<string, Seen>();
  private primed = false;
  /** Set by the extension; where the optional event file goes. */
  logsDir = '';
  private reminded = new Set<string>();
  private mirror: { key: string; resolve: () => void; report: vscode.Progress<{ message?: string; increment?: number }>; pct: number } | undefined;

  update(data: DashboardData, settings: Settings): void {
    const now = new Date();
    const n = settings.notifications;
    const keyOf = (p: ProgressData) => p.runId ? `run:${p.runId}` : `task:${p.task}|${p.startedAt ?? ''}`;

    for (const t of data.tasks) {
      const key = keyOf(t);
      const state = taskState(t, settings.staleRunningMinutes, now, data.overlays);
      const prev = this.seen.get(key);
      const cur: Seen = { state, warnings: t.warnings?.length ?? 0, updatedAt: t.updatedAt, slaWarned: prev?.slaWarned };
      this.seen.set(key, cur);
      if (!this.primed || !prev) continue; // first sight: no notification, just remember it

      if (n.onSlow && state === 'running' && !cur.slaWarned) {
        const sla = slaFor(t.task, settings.processes);
        if (typeof sla === 'number' && liveElapsed(t, now) > sla * 60) {
          cur.slaWarned = true;
          this.warn(`⏱ ${t.task} has been running for ${formatDuration(liveElapsed(t, now))}, past its ${formatDuration(sla * 60)} limit`);
        }
      }

      if (prev.state !== state) {
        // The event file mirrors the same transitions the notifications use, whether or not
        // the matching notification is switched on: a watcher wants the event, not the toast.
        if (settings.events.file && (state === 'complete' || state === 'failed' || state === 'stalled' || state === 'exited')) {
          const o = state === 'exited' ? data.overlays.find(x => x.task === t.task) : undefined;
          writeEvent(this.logsDir, {
            event: state, task: t.task, at: new Date().toISOString(), runId: t.runId,
            elapsed: t.elapsed, step: t.step, totalSteps: t.totalSteps, label: t.label,
            detail: t.detail, warnings: t.warnings?.length ?? 0,
            ...(o ? { exitCode: o.exitCode } : {}),
            ...(t.metrics && Object.keys(t.metrics).length ? { metrics: t.metrics } : {}),
          }, vscode.workspace.isTrusted);
        }
        if (state === 'complete' && n.onComplete) this.info(`✓ ${t.task} completed in ${formatDuration(t.elapsed)}${t.detail ? ` — ${t.detail}` : ''}`);
        if (state === 'complete' && n.onSlow && settings.runHistory.anomalies) {
          const rec = data.history.find(r => (t.runId && r.runId === t.runId) || (r.task === t.task && r.date === t.updatedAt));
          const v = rec ? durationVerdict(rec, data.history, settings.runHistory.anomalyFactor) : undefined;
          if (v?.slow && rec) this.warn(`⏱ ${t.task} took ${formatDuration(rec.elapsed)} — ${v.factor.toFixed(1)}× its usual ${formatDuration(v.baseline)}`);
        }
        if (state === 'failed' && n.onFail) this.error(`✗ ${t.task} FAILED${t.detail ? ` — ${t.detail}` : ''}`);
        if (state === 'stalled' && n.onStall) this.warn(`⚠ ${t.task} looks stalled: no update for ${settings.staleRunningMinutes} min (step ${t.step}/${t.totalSteps}, ${t.label})`);
        if (state === 'exited' && n.onExit) {
          const o = data.overlays.find(x => x.task === t.task);
          this.error(`✗ ${t.task}: the process exited with code ${o?.exitCode ?? '?'} while still reporting "running"`);
        }
      }
      if (n.onWarning && state === 'running' && cur.warnings > prev.warnings) {
        const latest = t.warnings[t.warnings.length - 1];
        this.warn(`⚠ ${t.task}: ${latest?.msg ?? 'new warning'}`);
      }
    }
    // Forget runs that vanished (slot pruned).
    const live = new Set(data.tasks.map(keyOf));
    for (const k of [...this.seen.keys()]) if (!live.has(k)) this.seen.delete(k);
    this.primed = true;

    this.remind(data, settings, now);
    this.updateMirror(data, settings, now);
  }

  /**
   * "Due in 2 days" — once per process per due date. Reminders are the one notification that is
   * about something that has NOT happened, so they must not repeat: a nag every refresh would
   * be worse than no reminder at all.
   */
  private remind(data: DashboardData, settings: Settings, now: Date): void {
    if (!settings.processes.length) return;
    for (const { row, daysLeft } of dueReminders(calendarRows(settings.processes, data.history, now), now)) {
      const key = `${row.process.name}|${row.nextDue.toDateString()}`;
      if (this.reminded.has(key)) continue;
      this.reminded.add(key);
      if (!this.primed) continue;      // do not fire a burst on activation
      const label = row.process.label || row.process.name;
      const when = daysLeft < 1 ? 'today' : daysLeft < 2 ? 'tomorrow' : `in ${Math.round(daysLeft)} days`;
      const phases = row.phases.length ? ` (${row.note})` : '';
      this.info(`${label} is due ${when}${phases}`);
    }
  }

  /** A native VS Code progress toast that follows the (first) running task. */
  private updateMirror(data: DashboardData, settings: Settings, now: Date): void {
    const running = settings.notifications.mirrorProgress
      ? data.tasks.find(t => taskState(t, settings.staleRunningMinutes, now, data.overlays) === 'running')
      : undefined;
    const key = running ? (running.runId ? `run:${running.runId}` : `task:${running.task}|${running.startedAt ?? ''}`) : '';

    if (this.mirror && this.mirror.key !== key) {
      this.mirror.resolve();
      this.mirror = undefined;
    }
    if (!running) return;
    const pct = percent(running.step, running.totalSteps, running.substep);
    const message = `${running.totalSteps ? `${running.step}/${running.totalSteps} ` : ''}${running.label}${running.detail ? ` — ${running.detail}` : ''}`;
    if (!this.mirror) {
      let resolve: () => void = () => undefined;
      const done = new Promise<void>(r => { resolve = r; });
      void vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Script Progress: ${running.task}`, cancellable: false },
        (report) => {
          this.mirror = { key, resolve, report, pct: 0 };
          report.report({ message, increment: pct });
          this.mirror.pct = pct;
          return done;
        },
      );
    } else {
      const inc = pct - this.mirror.pct;
      this.mirror.report.report({ message, increment: inc > 0 ? inc : 0 });
      if (inc > 0) this.mirror.pct = pct;
    }
  }

  private actions = ['Open Dashboard', 'Run History'];
  private handle(pick: string | undefined): void {
    if (pick === 'Open Dashboard') void vscode.commands.executeCommand('scriptProgress.openPanel');
    if (pick === 'Run History') void vscode.commands.executeCommand('scriptProgress.showHistory');
  }
  private info(msg: string) { void vscode.window.showInformationMessage(msg, ...this.actions).then(p => this.handle(p)); }
  private warn(msg: string) { void vscode.window.showWarningMessage(msg, ...this.actions).then(p => this.handle(p)); }
  private error(msg: string) { void vscode.window.showErrorMessage(msg, ...this.actions).then(p => this.handle(p)); }

  dispose(): void {
    this.mirror?.resolve();
    this.mirror = undefined;
  }
}
