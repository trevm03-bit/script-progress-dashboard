// The weekly digest, calendar reminders, and metric totals.
const test = require('node:test');
const assert = require('node:assert');
const { weeklyDigestText } = require('../out/logic/summary.js');
const { dueReminders, calendarRows } = require('../out/logic/calendar.js');
const { metricsModel } = require('../out/logic/metricsExplorer.js');
const { settings: S } = require('./fixtures/settings.js');

const NOW = new Date(2026, 8, 10, 12, 0, 0); // Thu 10 Sep 2026
const at = (day, hour = 10) => new Date(2026, 8, day, hour, 0, 0).toISOString();
const run = (o = {}) => ({ task: 'Rec', date: at(9), success: true, elapsed: 60, summary: '', warnings: 0, ...o });

const data = (o = {}) => ({
  progress: null, tasks: [], history: [], deltas: {}, access: null, overlays: [], logsDir: '', errors: [], ...o,
});

test('the digest counts the week and breaks it down by script', () => {
  const d = data({
    history: [
      run({ task: 'Rec', date: at(8), elapsed: 60 }),
      run({ task: 'Rec', date: at(9), elapsed: 80, warnings: 2 }),
      run({ task: 'Load', date: at(9), success: false, summary: 'boom', category: 'auth' }),
    ],
  });
  const text = weeklyDigestText(d, S({ processes: [] }), NOW);
  assert.match(text, /week of 2026-09-04 to 2026-09-10/);
  assert.match(text, /3 run\(s\) · 1 failed · 2 warning\(s\)/);
  assert.match(text, /Rec: 2 run\(s\), 2 warning\(s\)/);
  assert.match(text, /Load: 1 run\(s\), 1 FAILED/);
  assert.match(text, /Failures:/);
  assert.match(text, /Load \[auth\] — boom/);
});

test('runs outside the window are excluded', () => {
  const d = data({ history: [run({ date: at(1) }), run({ date: at(9) })] });
  assert.match(weeklyDigestText(d, S({ processes: [] }), NOW), /1 run\(s\)/);
});

test('the digest names a failure pattern when there is one', () => {
  const d = data({
    history: [
      run({ task: 'A', date: at(7), success: false, category: 'auth' }),
      run({ task: 'B', date: at(8), success: false, category: 'auth' }),
      run({ task: 'C', date: at(9), success: false, category: 'quota' }),
    ],
  });
  assert.match(weeklyDigestText(d, S({ processes: [] }), NOW), /Pattern: 2 of the last 3 failures were auth/);
});

test('the digest reports calendar state including part-done and unwired', () => {
  const processes = [
    { name: 'Rec', label: 'Rec', frequency: 'daily' },
    { name: 'Phased', label: 'Phased', frequency: 'monthly', dayOfMonth: 25, subtasks: ['Phased A', 'Phased B'] },
    { name: 'Ghost', label: 'Ghost', frequency: 'daily' },
  ];
  const d = data({ history: [run({ task: 'Rec', date: at(10) }), run({ task: 'Phased A', date: at(3) })] });
  const text = weeklyDigestText(d, S({ processes }), NOW);
  assert.match(text, /Phased: 1 of 2 phases/);
  assert.match(text, /not wired yet: Ghost/);
});

test('the digest shows how a tracked metric moved across the week', () => {
  const d = data({
    deltas: { drift: [
      { date: at(6), value: 10, task: 'Rec' },
      { date: at(9), value: 2, task: 'Rec' },
    ] },
  });
  const text = weeklyDigestText(d, S({ processes: [], deltaMetrics: ['drift'] }), NOW);
  assert.match(text, /drift: 10 -> 2 \(down\)/);
});

test('an empty week still produces something sendable', () => {
  const text = weeklyDigestText(data(), S({ processes: [] }), NOW);
  assert.match(text, /0 run\(s\) · 0 failed/);
  assert.doesNotMatch(text, /undefined|NaN/);
});

// ---------------------------------------------------------------- reminders
test('a reminder fires inside its window and not outside it', () => {
  const processes = [{ name: 'Close', label: 'Close', frequency: 'monthly', dayOfMonth: 12, reminderDays: 3 }];
  // Ran in AUGUST, so September is still pending — a run on 1 Sept would count as done
  // for the month and push the next due date out to October.
  const hist = [run({ task: 'Close', date: new Date(2026, 7, 12, 10).toISOString() })];
  const rows = calendarRows(processes, hist, NOW);
  const due = dueReminders(rows, NOW);
  assert.equal(due.length, 1, 'due on the 12th, reminding 3 days out, today is the 10th');
  assert.ok(due[0].daysLeft <= 3);

  const early = new Date(2026, 8, 5, 12, 0, 0);
  assert.equal(dueReminders(calendarRows(processes, hist, early), early).length, 0, 'still a week away');
});

test('no reminder without reminderDays, and none for done, overdue or unwired', () => {
  const noFlag = [{ name: 'Close', label: 'Close', frequency: 'monthly', dayOfMonth: 12 }];
  const lastMonth = [run({ task: 'Close', date: new Date(2026, 7, 12, 10).toISOString() })];
  assert.equal(dueReminders(calendarRows(noFlag, lastMonth, NOW), NOW).length, 0);

  const done = [{ name: 'Rec', label: 'Rec', frequency: 'daily', reminderDays: 3 }];
  assert.equal(dueReminders(calendarRows(done, [run({ task: 'Rec', date: at(10) })], NOW), NOW).length, 0, 'already done today');

  const ghost = [{ name: 'Ghost', label: 'Ghost', frequency: 'daily', reminderDays: 3 }];
  assert.equal(dueReminders(calendarRows(ghost, [], NOW), NOW).length, 0, 'never reported: nothing to remind about');
});

// ---------------------------------------------------------------- metric totals
test('metric rows carry a total and a mean for numeric series only', () => {
  const d = data({
    history: [
      run({ task: 'Rec', date: at(8), metrics: { cost: 0.1, note: 'a' } }),
      run({ task: 'Rec', date: at(9), metrics: { cost: 0.2, note: 'b' } }),
    ],
  });
  const model = metricsModel(d, S({ metricsExplorer: { maxRuns: 12, metrics: [], totals: true } }));
  const rows = Object.fromEntries(model.tasks[0].rows.map(r => [r.key, r]));
  assert.equal(rows.cost.total, 0.3, 'floating point noise is rounded away');
  assert.equal(rows.cost.mean, 0.15);
  assert.equal(rows.note.total, null, 'a text metric has no total');
  assert.equal(rows.note.mean, null);
});

// ---------------------------------------------------------------- reported 2026-09-04
test('a never-reported process is never announced as "next due"', () => {
  // The strip said "overdue · NEXT: Morning Scan" while the calendar said "not wired yet" for
  // the same process. Two views of one fact disagreeing; the strip was wrong.
  const { summaryFacts } = require('../out/logic/summary.js');
  const processes = [{ name: 'Ghost', label: 'Ghost', frequency: 'daily', dueHour: 9 }];
  const d = data();
  const f = summaryFacts(d, S({ processes }), NOW);   // NOW is 12:00, so 09:00 is already past
  assert.equal(f.nextDue, null, 'nothing has ever reported it, so it has no next due');
  assert.deepEqual(f.overdue, [], 'and it is not overdue either');
});

test('"next due" is never a date already in the past', () => {
  const { summaryFacts } = require('../out/logic/summary.js');
  const processes = [
    { name: 'Ghost', label: 'Ghost', frequency: 'daily', dueHour: 9 },
    { name: 'Rec', label: 'Rec', frequency: 'daily', dueHour: 23 },
  ];
  const d = data({ history: [run({ task: 'Rec', date: at(9) })] });
  const f = summaryFacts(d, S({ processes }), NOW);
  if (f.nextDue) assert.doesNotMatch(f.nextDue.text, /overdue/, 'a "next" that is overdue is a contradiction');
});
