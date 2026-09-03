// Time helpers. Pure: every function that depends on "now" takes it as a parameter,
// so tests can pin the clock.
import { ProgressData, TaskState } from '../types';

/** 45 -> "45s", 125 -> "2m5s", 3600 -> "60m", 7261 -> "2h1m". */
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
 * The script's start time, derived from the last write: updatedAt minus the elapsed
 * seconds it reported. This lets the dashboard tick elapsed time live between writes.
 */
export function deriveStart(progress: ProgressData): Date | null {
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

/**
 * The state shown to the user. A 'running' file that has not been touched for
 * staleRunningMinutes almost always means the script died without calling complete().
 */
export function taskState(progress: ProgressData | null, staleRunningMinutes: number, now: Date): TaskState {
  if (!progress) return 'idle';
  if (progress.status === 'complete') return 'complete';
  if (progress.status === 'failed') return 'failed';
  return minutesSinceUpdate(progress, now) > staleRunningMinutes ? 'stalled' : 'running';
}

/** 0..100, safe for total = 0. */
export function percent(step: number, total: number): number {
  if (!total || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((step / total) * 100)));
}
