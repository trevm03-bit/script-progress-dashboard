// Process Calendar logic: has each expected process run when it should have, when is it next
// due, and what does its month look like day by day? Pure; all date maths is LOCAL time.
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
  /** When the next run is due (local). */
  nextDue: Date;
}

/** One day cell of a month grid. */
export interface DayCell {
  day: number;
  /** 'ok' | 'fail' | 'none' | 'future' */
  state: 'ok' | 'fail' | 'none' | 'future';
  runs: number;
  today: boolean;
  due: boolean;
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

function endOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59);
}

function daysInMonth(y: number, m: number): number {
  return new Date(y, m + 1, 0).getDate();
}

/** The local date on which the process is due in the period containing `now`. */
export function dueDate(process: ProcessConfig, now: Date): Date {
  switch (process.frequency) {
    case 'daily': {
      const h = process.dueHour ?? 12;
      return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, 0, 0);
    }
    case 'weekly': {
      const start = startOfIsoWeek(now);
      const dow = Math.min(7, Math.max(1, process.dayOfWeek ?? 7));
      const d = new Date(start);
      d.setDate(start.getDate() + dow - 1);
      return endOfDay(d);
    }
    case 'monthly':
    default: {
      const dim = daysInMonth(now.getFullYear(), now.getMonth());
      const day = Math.min(dim, Math.max(1, process.dayOfMonth ?? dim));
      return endOfDay(new Date(now.getFullYear(), now.getMonth(), day));
    }
  }
}

/** The due date of the NEXT period after `now`. */
export function nextPeriodDue(process: ProcessConfig, now: Date): Date {
  switch (process.frequency) {
    case 'daily': return dueDate(process, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
    case 'weekly': return dueDate(process, new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));
    case 'monthly':
    default: return dueDate(process, new Date(now.getFullYear(), now.getMonth() + 1, 1));
  }
}

export function processStatus(process: ProcessConfig, history: RunRecord[], now: Date): CalendarRow {
  const runs = runsFor(process, history);
  const lastRun = runs[0] ?? null;
  const lastSuccess = runs.find(r => r.success) ?? null;
  const lastSuccessDate = lastSuccess ? parseIso(lastSuccess.date) : null;

  let status: CalendarStatus = 'pending';
  let note = '';
  let donePeriod = false;

  switch (process.frequency) {
    case 'daily': {
      donePeriod = !!lastSuccessDate && sameLocalDay(lastSuccessDate, now);
      if (donePeriod) { status = 'done'; note = 'ran today'; }
      else if (now >= dueDate(process, now)) { status = 'overdue'; note = 'not run today'; }
      else { status = 'pending'; note = `due today by ${String(process.dueHour ?? 12).padStart(2, '0')}:00`; }
      break;
    }
    case 'weekly': {
      const weekStart = startOfIsoWeek(now);
      const prevWeekStart = new Date(weekStart.getTime() - 7 * 86400000);
      donePeriod = !!lastSuccessDate && lastSuccessDate >= weekStart;
      if (donePeriod) { status = 'done'; note = 'ran this week'; }
      else if (now > dueDate(process, now)) { status = 'overdue'; note = 'missed this week'; }
      else if (lastSuccessDate && lastSuccessDate >= prevWeekStart) { status = 'pending'; note = 'due this week'; }
      else { status = 'overdue'; note = lastSuccessDate ? 'missed last week' : 'never run'; }
      break;
    }
    case 'monthly':
    default: {
      donePeriod = !!lastSuccessDate && sameLocalMonth(lastSuccessDate, now);
      if (donePeriod) { status = 'done'; note = 'ran this month'; }
      else if (now > dueDate(process, now)) { status = 'overdue'; note = `was due by day ${process.dayOfMonth ?? daysInMonth(now.getFullYear(), now.getMonth())}`; }
      else { status = 'pending'; note = process.dayOfMonth !== undefined ? `due by day ${process.dayOfMonth}` : 'due this month'; }
      break;
    }
  }

  // A failed run after the last success is worth surfacing even when the status is fine.
  if (lastRun && !lastRun.success && lastRun !== lastSuccess) {
    const lr = parseIso(lastRun.date);
    if (lr && (!lastSuccessDate || lr > lastSuccessDate)) note += (note ? ' · ' : '') + 'last attempt failed';
  }

  const nextDue = donePeriod ? nextPeriodDue(process, now) : dueDate(process, now);
  return { process, status, lastRun, lastSuccess, note, nextDue };
}

export function calendarRows(processes: ProcessConfig[], history: RunRecord[], now: Date): CalendarRow[] {
  return processes.map(p => processStatus(p, history, now));
}

/** Day-by-day cells for the month containing `now`, for one process. */
export function monthGrid(process: ProcessConfig, history: RunRecord[], now: Date): DayCell[] {
  const y = now.getFullYear();
  const m = now.getMonth();
  const dim = daysInMonth(y, m);
  const cells: DayCell[] = [];
  const runs = runsFor(process, history).filter(r => {
    const d = parseIso(r.date);
    return d && d.getFullYear() === y && d.getMonth() === m;
  });
  const dueDay = process.frequency === 'monthly' ? Math.min(dim, process.dayOfMonth ?? dim) : 0;
  for (let day = 1; day <= dim; day++) {
    const dayRuns = runs.filter(r => parseIso(r.date)!.getDate() === day);
    let state: DayCell['state'] = 'none';
    if (day > now.getDate()) state = 'future';
    else if (dayRuns.length) state = dayRuns.some(r => r.success) ? 'ok' : 'fail';
    cells.push({ day, state, runs: dayRuns.length, today: day === now.getDate(), due: day === dueDay });
  }
  return cells;
}

/** Short "due in 3h" / "due tomorrow" / "due 5 Sep" text. */
export function dueText(nextDue: Date, now: Date): string {
  const ms = nextDue.getTime() - now.getTime();
  if (ms < 0) return 'overdue';
  const h = ms / 3600000;
  if (h < 1) return `due in ${Math.max(1, Math.round(ms / 60000))}m`;
  if (h < 24 && sameLocalDay(nextDue, now)) return `due in ${Math.round(h)}h`;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (sameLocalDay(nextDue, tomorrow)) return 'due tomorrow';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `due ${nextDue.getDate()} ${months[nextDue.getMonth()]}`;
}
