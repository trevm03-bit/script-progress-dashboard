// Process Calendar logic: has each expected process run when it should have?
// Pure; all date maths is LOCAL time because "this month" means the user's month.
import { ProcessConfig, RunRecord } from '../types';
import { parseIso } from './time';

export type CalendarStatus = 'done' | 'pending' | 'overdue';

export interface CalendarRow {
  process: ProcessConfig;
  status: CalendarStatus;
  /** Most recent run (success or not) matching the process, or null. */
  lastRun: RunRecord | null;
  /** Most recent SUCCESSFUL run, or null. */
  lastSuccess: RunRecord | null;
  /** Plain-English reason, e.g. "due by day 5", "ran today". */
  note: string;
}

/** A run belongs to a process when its task name STARTS WITH the process name (case-insensitive). */
export function matchesProcess(taskName: string, process: ProcessConfig): boolean {
  if (!process.name) return false;
  return (taskName || '').toLowerCase().startsWith(process.name.toLowerCase());
}

/** Newest-first list of runs for a process. */
export function runsFor(process: ProcessConfig, history: RunRecord[]): RunRecord[] {
  return history
    .filter(r => matchesProcess(r.task, process))
    .sort((a, b) => (parseIso(b.date)?.getTime() ?? 0) - (parseIso(a.date)?.getTime() ?? 0));
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function sameLocalMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** Monday 00:00 local of the ISO week containing `d`. */
export function startOfIsoWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = out.getDay(); // 0 = Sunday
  const diff = day === 0 ? 6 : day - 1;
  out.setDate(out.getDate() - diff);
  return out;
}

export function processStatus(process: ProcessConfig, history: RunRecord[], now: Date): CalendarRow {
  const runs = runsFor(process, history);
  const lastRun = runs[0] ?? null;
  const lastSuccess = runs.find(r => r.success) ?? null;
  const lastSuccessDate = lastSuccess ? parseIso(lastSuccess.date) : null;

  let status: CalendarStatus = 'pending';
  let note = '';

  switch (process.frequency) {
    case 'daily': {
      if (lastSuccessDate && sameLocalDay(lastSuccessDate, now)) {
        status = 'done'; note = 'ran today';
      } else if (now.getHours() >= 12) {
        status = 'overdue'; note = 'not run today';
      } else {
        status = 'pending'; note = 'due today';
      }
      break;
    }
    case 'weekly': {
      // done = ran this ISO week; pending = ran last week (this week's run still due);
      // overdue = missed a whole week or never ran.
      const weekStart = startOfIsoWeek(now);
      const prevWeekStart = new Date(weekStart.getTime() - 7 * 86400000);
      if (lastSuccessDate && lastSuccessDate >= weekStart) {
        status = 'done'; note = 'ran this week';
      } else if (lastSuccessDate && lastSuccessDate >= prevWeekStart) {
        status = 'pending'; note = 'due this week';
      } else {
        status = 'overdue'; note = lastSuccessDate ? 'missed last week' : 'never run';
      }
      break;
    }
    case 'monthly':
    default: {
      if (lastSuccessDate && sameLocalMonth(lastSuccessDate, now)) {
        status = 'done'; note = 'ran this month';
      } else if (process.dayOfMonth !== undefined && now.getDate() > process.dayOfMonth) {
        status = 'overdue'; note = `was due by day ${process.dayOfMonth}`;
      } else {
        status = 'pending';
        note = process.dayOfMonth !== undefined ? `due by day ${process.dayOfMonth}` : 'due this month';
      }
      break;
    }
  }

  // A failed run after the last success is worth surfacing even when the status is fine.
  if (lastRun && !lastRun.success && lastRun !== lastSuccess) {
    const lr = parseIso(lastRun.date);
    if (lr && (!lastSuccessDate || lr > lastSuccessDate)) note += (note ? ' · ' : '') + 'last attempt failed';
  }

  return { process, status, lastRun, lastSuccess, note };
}

export function calendarRows(processes: ProcessConfig[], history: RunRecord[], now: Date): CalendarRow[] {
  return processes.map(p => processStatus(p, history, now));
}
