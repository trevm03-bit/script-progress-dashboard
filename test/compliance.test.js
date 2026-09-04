// SLA compliance, impact totals, pending actions, coverage, metric anomalies and blocked
// dependencies. These carry the judgements that matter most, so the tests are about the
// judgements, not only the arithmetic.
const test = require('node:test');
const assert = require('node:assert');
const { complianceReport, impactTotals, pendingActions, coverage } = require('../out/logic/compliance.js');
const { metricAnomalies } = require('../out/logic/anomaly.js');
const { processStatus, unmetDependencies } = require('../out/logic/calendar.js');

const NOW = new Date(2026, 8, 10, 12, 0, 0);           // Thu 10 Sep 2026
const iso = (y, m, d, h = 10) => new Date(y, m, d, h).toISOString();
const run = (o = {}) => ({ task: 'Rec', date: iso(2026, 8, 9), success: true, elapsed: 60, summary: '', warnings: 0, ...o });

// ---------------------------------------------------------------- compliance
test('monthly compliance counts complete periods and ignores the current one', () => {
  const hist = [
    run({ task: 'Close', date: iso(2026, 5, 3) }),   // Jun
    run({ task: 'Close', date: iso(2026, 6, 4) }),   // Jul
    // August missed
    run({ task: 'Close', date: iso(2026, 8, 2) }),   // Sep — current period, must not count
  ];
  const p = { name: 'Close', label: 'Close', frequency: 'monthly', dayOfMonth: 5 };
  const r = complianceReport(p, hist, NOW, 3);        // Jun, Jul, Aug
  assert.deepEqual(r.periods.map(x => x.met), [true, true, false]);
  assert.equal(r.met, 2);
  assert.equal(r.of, 3);
  assert.equal(r.percent, 67);
  assert.equal(r.streak, 0, 'the most recent complete period was missed');
});

test('periods before the process ever ran are unknown, not missed', () => {
  const hist = [run({ task: 'New', date: iso(2026, 8, 2) })];
  const p = { name: 'New', label: 'New', frequency: 'monthly', dayOfMonth: 5 };
  const r = complianceReport(p, hist, NOW, 6);
  assert.equal(r.of, 0, 'nothing before its first run can be judged');
  assert.equal(r.percent, null, 'a brand-new process is not "0%"');
});

test('a clean streak is counted back from the last complete period', () => {
  const hist = [5, 6, 7].map(m => run({ task: 'Close', date: iso(2026, m, 3) }));
  const p = { name: 'Close', label: 'Close', frequency: 'monthly', dayOfMonth: 5 };
  const r = complianceReport(p, hist, NOW, 3);
  assert.equal(r.streak, 3);
  assert.equal(r.percent, 100);
});

// ---------------------------------------------------------------- impact
test('impact accumulates per metric, counts runs and isolates this month', () => {
  const impact = {
    corrections: [
      { date: iso(2026, 7, 20), value: 100, task: 'Rec', runId: 'a', label: 'Corrections' },
      { date: iso(2026, 8, 2), value: 200.5, task: 'Rec', runId: 'b' },
      { date: iso(2026, 8, 3), value: 50.25, task: 'Rec', runId: 'b' },   // same run
    ],
  };
  const [t] = impactTotals(impact, NOW);
  assert.equal(t.total, 350.75);
  assert.equal(t.thisMonth, 250.75, 'August is excluded');
  assert.equal(t.runs, 2, 'two points from one run are one run');
  assert.equal(t.label, 'Corrections');
});

test('impact ignores unusable points instead of producing NaN', () => {
  const impact = { m: [{ date: iso(2026, 8, 2), value: 'x', task: 'T' }, { date: iso(2026, 8, 3), value: 5, task: 'T' }] };
  const [t] = impactTotals(impact, NOW);
  assert.equal(t.total, 5);
});

// ---------------------------------------------------------------- pending actions
test('actionable warnings come from the latest SUCCESSFUL run of each task', () => {
  const hist = [
    run({ task: 'Scan', date: iso(2026, 8, 8), warningItems: [
      { time: 't', msg: 'old item', actionable: true },
      { time: 't', msg: 'just noise' },
    ] }),
    run({ task: 'Scan', date: iso(2026, 8, 9), warningItems: [
      { time: 't', msg: 'still outstanding', actionable: true },
    ] }),
  ];
  const p = pendingActions(hist, NOW);
  assert.deepEqual(p.map(x => x.msg), ['still outstanding']);
  assert.equal(p[0].task, 'Scan');
});

test('a FAILED later run cannot clear an outstanding item', () => {
  // The failure may have died before reaching the check. Treating "did not mention it" as
  // "dealt with" would quietly retire real findings.
  const hist = [
    run({ task: 'Scan', date: iso(2026, 8, 8), warningItems: [{ time: 't', msg: 'outstanding', actionable: true }] }),
    run({ task: 'Scan', date: iso(2026, 8, 9), success: false, warningItems: [] }),
  ];
  assert.deepEqual(pendingActions(hist, NOW).map(x => x.msg), ['outstanding']);
});

test('a later successful run that omits the item does clear it', () => {
  const hist = [
    run({ task: 'Scan', date: iso(2026, 8, 8), warningItems: [{ time: 't', msg: 'outstanding', actionable: true }] }),
    run({ task: 'Scan', date: iso(2026, 8, 9), warningItems: [] }),
  ];
  assert.deepEqual(pendingActions(hist, NOW), []);
});

test('non-actionable warnings are never pending actions', () => {
  const hist = [run({ task: 'Scan', warningItems: [{ time: 't', msg: 'fyi', count: 310 }] })];
  assert.deepEqual(pendingActions(hist, NOW), []);
});

// ---------------------------------------------------------------- coverage
test('coverage weights its inputs and always exposes them', () => {
  const cal = [{ status: 'done' }, { status: 'done' }, { status: 'overdue' }];
  const hist = [run(), run(), run({ success: false })];
  const c = coverage(cal, hist, 1, 2, NOW);
  assert.equal(c.inputs.length, 3);
  assert.ok(c.inputs.every(i => i.detail && i.label), 'every input states what it is');
  assert.ok(c.percent > 0 && c.percent < 100);
});

test('blocked and unwired processes do not count against coverage', () => {
  const clean = coverage([{ status: 'done' }], [run()], 0, 0, NOW);
  const withBlocked = coverage([{ status: 'done' }, { status: 'blocked' }, { status: 'unseen' }], [run()], 0, 0, NOW);
  assert.equal(clean.percent, withBlocked.percent, 'neither is this process failing to comply');
});

test('coverage is null rather than 100 when there is nothing to measure', () => {
  assert.equal(coverage([], [], 0, 0, NOW).percent, null);
});

// ---------------------------------------------------------------- metric anomalies
test('a metric far from its own median is flagged, in both directions', () => {
  const prior = [1, 2, 3, 4].map(d => run({ date: iso(2026, 8, d), metrics: { rows: 4000 } }));
  const dropped = run({ date: iso(2026, 8, 9), metrics: { rows: 200 } });
  const [v] = metricAnomalies(dropped, [...prior, dropped]);
  assert.equal(v.key, 'rows');
  assert.equal(v.direction, 'down');
  assert.equal(v.baseline, 4000);

  const spiked = run({ date: iso(2026, 8, 9), metrics: { rows: 12000 } });
  assert.equal(metricAnomalies(spiked, [...prior, spiked])[0].direction, 'up');
});

test('thin history and ignored metrics produce no flags', () => {
  const prior = [1, 2].map(d => run({ date: iso(2026, 8, d), metrics: { rows: 4000 } }));
  const now = run({ date: iso(2026, 8, 9), metrics: { rows: 10 } });
  assert.deepEqual(metricAnomalies(now, [...prior, now]), [], 'two prior runs is not a baseline');

  const prior4 = [1, 2, 3, 4].map(d => run({ date: iso(2026, 8, d), metrics: { rows: 4000 } }));
  assert.deepEqual(metricAnomalies(now, [...prior4, now], 2, ['rows']), [], 'explicitly ignored');
});

test('a metric that has always been zero and stays zero is not an anomaly', () => {
  const prior = [1, 2, 3, 4].map(d => run({ date: iso(2026, 8, d), metrics: { errors: 0 } }));
  const same = run({ date: iso(2026, 8, 9), metrics: { errors: 0 } });
  assert.deepEqual(metricAnomalies(same, [...prior, same]), []);
  const moved = run({ date: iso(2026, 8, 9), metrics: { errors: 7 } });
  assert.equal(metricAnomalies(moved, [...prior, moved])[0].key, 'errors');
});

test('text metrics are ignored rather than coerced', () => {
  const prior = [1, 2, 3, 4].map(d => run({ date: iso(2026, 8, d), metrics: { note: 'ok' } }));
  const now = run({ date: iso(2026, 8, 9), metrics: { note: 'different' } });
  assert.deepEqual(metricAnomalies(now, [...prior, now]), []);
});

// ---------------------------------------------------------------- blocked dependencies
test('a process whose dependency has not run this period is blocked, not overdue', () => {
  const proc = { name: 'CPS', label: 'CPS', frequency: 'monthly', dayOfMonth: 5, dependsOn: ['Load Phase 1'] };
  const late = new Date(2026, 8, 20, 12);
  const hist = [run({ task: 'CPS', date: iso(2026, 7, 4) })];   // ran last month only
  const r = processStatus(proc, hist, late);
  assert.equal(r.status, 'blocked', 'past its due day, but nothing it can do about it');
  assert.deepEqual(r.blockedBy, ['Load Phase 1']);
  assert.match(r.note, /waiting on Load Phase 1/);
});

test('a met dependency stops blocking', () => {
  const proc = { name: 'CPS', label: 'CPS', frequency: 'monthly', dayOfMonth: 5, dependsOn: ['Load Phase 1'] };
  const dep = [run({ task: 'Load Phase 1-2', date: iso(2026, 8, 2) })];
  assert.deepEqual(unmetDependencies(proc, dep, NOW), [], 'prefix match, this period, successful');
  // With the dependency met but CPS itself never seen, 'unseen' is the honest answer — nothing
  // has ever reported CPS, so we do not know it is wired at all.
  assert.equal(processStatus(proc, dep, NOW).status, 'unseen');
  // Once CPS has a history, a met dependency leaves it un-blocked. Due on the 25th and today is
  // the 10th, so the honest status is 'pending' — the point is only that it is not 'blocked'.
  const notYetDue = { ...proc, dayOfMonth: 25 };
  const withHistory = [...dep, run({ task: 'CPS', date: iso(2026, 7, 4) })];
  assert.equal(processStatus(notYetDue, withHistory, NOW).status, 'pending');
});

test('a never-run process that is also blocked says BOTH, never-run first', () => {
  const proc = { name: 'CPS', label: 'CPS', frequency: 'monthly', dayOfMonth: 5, dependsOn: ['Load Phase 1'] };
  const r = processStatus(proc, [], NOW);
  assert.equal(r.status, 'unseen');
  assert.match(r.note, /^no run recorded yet/, 'leading with "waiting on X" would imply it would otherwise have run');
  assert.match(r.note, /waiting on Load Phase 1/);
});

test('a failed dependency run does not satisfy the dependency', () => {
  const proc = { name: 'CPS', label: 'CPS', frequency: 'monthly', dayOfMonth: 5, dependsOn: ['Load Phase 1'] };
  const hist = [run({ task: 'Load Phase 1-2', date: iso(2026, 8, 2), success: false })];
  assert.deepEqual(unmetDependencies(proc, hist, NOW), ['Load Phase 1']);
});

test('having run this period beats being blocked', () => {
  const proc = { name: 'CPS', label: 'CPS', frequency: 'monthly', dayOfMonth: 5, dependsOn: ['Missing'] };
  const hist = [run({ task: 'CPS', date: iso(2026, 8, 2) })];
  assert.equal(processStatus(proc, hist, NOW).status, 'done', 'if it ran, it ran');
});
