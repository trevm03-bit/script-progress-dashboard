// Turns state TRANSITIONS into VS Code notifications, and optionally mirrors the running task
// into a native progress notification. Nothing fires for state that already existed when the
// extension activated — only for changes seen while it was watching.
import * as vscode from 'vscode';
import { DashboardData, ProgressData, Settings, TaskState } from './types';
import { formatDuration, percent, taskState, liveElapsed, sameTask } from './logic/time';
import { durationVerdict, slaFor } from './logic/anomaly';
import { calendarRows, dueReminders } from './logic/calendar';
import { RunEvent, writeEvent } from './eventFile';

interface Seen {
  state: TaskState;
  warnings: number;
  updatedAt: string;
  /**
   * Seconds elapsed as of this sighting. Only used to notice that a NEW run has started when
   * the producer gives us nothing else to tell runs apart.
   */
  elapsed?: number;
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
    // Capture this BEFORE anything can set it. `primed` was raised at the end of the task loop and
    // only then was remind() called, so its own "do not fire a burst on activation" guard could
    // never be true - every window open produced a toast for every process in its reminder window,
    // which is precisely what that guard exists to prevent.
    const wasPrimed = this.primed;
    const n = settings.notifications;
    const keyOf = (p: ProgressData) => p.runId ? `run:${p.runId}` : `task:${p.task}|${p.startedAt ?? ''}`;
    const pending: RunEvent[] = [];

    for (const t of data.tasks) {
      const key = keyOf(t);
      const state = taskState(t, settings.staleRunningMinutes, now, data.overlays);
      const prev = this.seen.get(key);
      // 🔴 The TRUE total, not the length of the trimmed array. The reporter caps the slot's
      // ordinary warnings at 20 and carries the real count in warningsTotal, so comparing
      // lengths meant `cur.warnings > prev.warnings` could never be true again after the
      // twentieth - onWarning went quiet on precisely the runs worth watching.
      const warnings = Math.max(t.warningsTotal ?? 0, t.warnings?.length ?? 0);
      // 🔴 And the SLA flag must not outlive its run. The `seen` key falls back to
      // `task:<name>|<startedAt>` and both runId and startedAt are documented Optional, so a
      // producer that writes neither gives every run of that script the identical key
      // `task:<name>|` - the first run to blow its limit silenced onSlow for ever after.
      // Elapsed going BACKWARDS is the one signal every producer emits when a run restarts.
      const restarted = !!prev && typeof t.elapsed === 'number' && typeof prev.elapsed === 'number'
        && t.elapsed < prev.elapsed;
      const cur: Seen = { state, warnings, updatedAt: t.updatedAt, elapsed: t.elapsed,
        slaWarned: restarted ? false : prev?.slaWarned };
      this.seen.set(key, cur);
      if (!wasPrimed || !prev) continue; // first sight: no notification, just remember it

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
          // sameTask, not ===. The state that led here was resolved case-insensitively, so an
          // exact compare returned undefined and the event recorded no exit code at all - for the
          // one event class where the code is the whole payload.
          const o = state === 'exited' ? data.overlays.find(x => sameTask(x.task, t.task)) : undefined;
          pending.push({
            event: state, task: t.task, at: new Date().toISOString(), runId: t.runId,
            elapsed: t.elapsed, step: t.step, totalSteps: t.totalSteps, label: t.label,
            detail: t.detail, warnings: t.warnings?.length ?? 0,
            ...(o ? { exitCode: o.exitCode } : {}),
            ...(t.metrics && Object.keys(t.metrics).length ? { metrics: t.metrics } : {}),
          });
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
          const o = data.overlays.find(x => sameTask(x.task, t.task));
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

    // One write per refresh, and the most serious transition wins. writeEvent overwrites a single
    // fixed path, so two scripts transitioning inside the same 60 ms debounce used to leave only
    // whichever came last in slot order - and the one being dropped was as likely as not the
    // failure, which is the entire reason anything watches this file.
    if (pending.length) {
      const rank = (e: string) => (e === 'failed' ? 0 : e === 'exited' ? 1 : e === 'stalled' ? 2 : 3);
      pending.sort((a, b) => rank(a.event) - rank(b.event));
      writeEvent(this.logsDir, pending[0], vscode.workspace.isTrusted);
    }

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
    // Bounded: one entry per process per due date would otherwise accumulate for the life of the
    // window. Clearing wholesale is safe - every key still due is re-added on this same pass.
    if (this.reminded.size > 500) this.reminded.clear();
    for (const { row, daysLeft } of dueReminders(calendarRows(settings.processes, data.history, now), now)) {
      const key = `${row.process.name}|${row.nextDue.toDateString()}`;
      if (this.reminded.has(key)) continue;
      // 🔴 Marked as reminded only when it actually fires. The key used to be added BEFORE the
      // wasPrimed guard, so anything already inside its reminder window when the window opened
      // was marked "already reminded" without ever producing a toast - and since a fresh
      // window is opened every day while reminder windows are days long, that is the normal
      // case. The whole reminderDays feature never fired.
      //
      // And wasPrimed does not apply here. It exists to stop a burst of TRANSITION
      // notifications for state that already existed at activation; a due-date reminder is not
      // a transition, and telling someone what is due is the point of opening the window. The
      // `reminded` set already bounds it to one toast per process per due date per window.
      this.reminded.add(key);
      const label = row.process.label || row.process.name;
      const when = daysLeft < 1 ? 'today' : daysLeft < 2 ? 'tomorrow' : `in ${Math.round(daysLeft)} days`;
      const phases = row.phases.length ? ` (${row.note})` : '';
      this.info(`${label} is due ${when}${phases}`);
    }
  }

  /** A native VS Code progress toast that follows the (first) running task. */
  private updateMirror(data: DashboardData, settings: Settings, now: Date): void {
    // 🔴 Stay with the run already being mirrored for as long as it is still running. This used
    // to take whichever running task DataReader happened to put first - and DataReader sorts by
    // updatedAt, so with two scripts running the leader flipped to whichever wrote its slot most
    // recently. Every flip failed the key comparison below, resolving the native progress toast
    // and opening a new one, once a second, for as long as both were running.
    const keyFor = (t: ProgressData) => (t.runId ? `run:${t.runId}` : `task:${t.task}|${t.startedAt ?? ''}`);
    const runningTasks = settings.notifications.mirrorProgress
      ? data.tasks.filter(t => taskState(t, settings.staleRunningMinutes, now, data.overlays) === 'running')
      : [];
    const mirrored = this.mirror ? runningTasks.find(t => keyFor(t) === this.mirror?.key) : undefined;
    const running = mirrored ?? runningTasks[0];
    const key = running ? keyFor(running) : '';

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
