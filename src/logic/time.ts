// Time helpers. Pure: every function that depends on "now" takes it as a parameter,
// so tests can pin the clock.
import { ProgressData, RunOverlay, TaskState } from '../types';

/** 45 -> "45s", 125 -> "2m5s", 3600 -> "1h", 7261 -> "2h1m". */
export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return m > 0 ? `${h}h${m}m` : `${h}h`;
  return s > 0 ? `${m}m${s}s` : `${m}m`;
}

/** Parse an ISO timestamp; null when missing or unparseable (never throws). */
export function parseIso(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** "just now", "5m ago", "2h ago", "3d ago", "6w ago". */
export function relativeTime(iso: string | null | undefined, now: Date): string {
  const d = parseIso(iso);
  if (!d) return 'never';
  const sec = Math.max(0, (now.getTime() - d.getTime()) / 1000);
  if (sec < 45) return 'just now';
  const min = sec / 60;
  if (min < 60) return `${Math.round(min)}m ago`;
  const hr = min / 60;
  if (hr < 24) return `${Math.round(hr)}h ago`;
  const day = hr / 24;
  if (day < 14) return `${Math.round(day)}d ago`;
  return `${Math.round(day / 7)}w ago`;
}

/** Local clock time "14:02". */
export function clockTime(iso: string | null | undefined): string {
  const d = parseIso(iso);
  if (!d) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Local date + time "2026-09-02 14:02". */
export function dateTime(iso: string | null | undefined): string {
  const d = parseIso(iso);
  if (!d) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * The script's start time: startedAt when the reporter gave it, else derived from the last
 * write (updatedAt minus the elapsed seconds it reported). Lets elapsed tick live between writes.
 */
export function deriveStart(progress: ProgressData): Date | null {
  const started = parseIso(progress.startedAt);
  if (started) return started;
  const updated = parseIso(progress.updatedAt);
  if (!updated) return null;
  return new Date(updated.getTime() - (progress.elapsed || 0) * 1000);
}

/** Seconds elapsed as of `now` while running; the reported figure once finished. */
export function liveElapsed(progress: ProgressData, now: Date): number {
  if (progress.status !== 'running') return progress.elapsed || 0;
  const start = deriveStart(progress);
  if (!start) return progress.elapsed || 0;
  return Math.max(0, (now.getTime() - start.getTime()) / 1000);
}

/** Live ETA: the reported ETA shrinks as time passes since the write. */
export function liveEta(progress: ProgressData, now: Date): number | null {
  if (progress.status !== 'running' || progress.eta === null || progress.eta === undefined) return null;
  const updated = parseIso(progress.updatedAt);
  if (!updated) return progress.eta;
  const since = (now.getTime() - updated.getTime()) / 1000;
  return Math.max(0, progress.eta - since);
}

/** Minutes since the file was last written. */
export function minutesSinceUpdate(progress: ProgressData, now: Date): number {
  const updated = parseIso(progress.updatedAt);
  if (!updated) return Infinity;
  return (now.getTime() - updated.getTime()) / 60000;
}

/** Does an exit overlay apply to this run? Same task, and the exit happened after the run started. */
export function exitOverlayFor(progress: ProgressData, overlays: RunOverlay[] | undefined): RunOverlay | null {
  if (!overlays || !overlays.length) return null;
  const start = deriveStart(progress)?.getTime() ?? 0;
  for (const o of overlays) {
    if (o.task !== progress.task) continue;
    const when = parseIso(o.when)?.getTime() ?? 0;
    if (when >= start - 1000) return o;
  }
  return null;
}

/**
 * The state shown to the user. A 'running' file that has not been touched for
 * staleRunningMinutes almost always means the script died without calling complete().
 */
export function taskState(progress: ProgressData | null, staleRunningMinutes: number, now: Date, overlays?: RunOverlay[]): TaskState {
  if (!progress) return 'idle';
  if (progress.status === 'complete') return 'complete';
  if (progress.status === 'failed') return 'failed';
  if (exitOverlayFor(progress, overlays)) return 'exited';
  return minutesSinceUpdate(progress, now) > staleRunningMinutes ? 'stalled' : 'running';
}

/** 0..100, safe for total = 0. Includes the fraction inside the current step when the reporter gave one. */
export function percent(step: number, total: number, substep?: number | null): number {
  if (!total || total <= 0) return 0;
  const frac = typeof substep === 'number' && isFinite(substep) ? Math.max(0, Math.min(1, substep)) : 0;
  const done = Math.max(0, step - 1) + (frac > 0 ? frac : step > 0 ? 1 : 0);
  // When no substep is reported, a step counts as done once it is the current step (matches the spec).
  const value = frac > 0 ? (done / total) * 100 : (step / total) * 100;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** A URL-safe slug the reporters use for per-task files: "Nightly Load 2" -> "nightly-load-2". */
export function slug(name: string): string {
  return (name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'task';
}
