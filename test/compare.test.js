// Comparing two runs, and the text it produces.
const test = require('node:test');
const assert = require('node:assert');
const { compareRuns, defaultBaseline, findRun, runKey } = require('../out/logic/compare.js');
const { comparisonText } = require('../out/logic/compareText.js');
const { failurePatterns, patternText } = require('../out/logic/failures.js');
const { withinRunPairs } = require('../out/logic/sparkline.js');

const run = (o = {}) => ({
  task: 'Rec', date: '2026-09-01T10:00:00', success: true, elapsed: 60, summary: '', warnings: 0, ...o,
});

test('metric differences carry direction, delta and percent', () => {
  const a = run({ metrics: { rows: 100, cost: 1.0, note: 'x' } });
  const b = run({ date: '2026-09-02T10:00:00', metrics: { rows: 150, cost: 1.0, extra: 5 } });
  const c = compareRuns(a, b);
  const by = Object.fromEntries(c.metrics.map(m => [m.key, m]));
  assert.equal(by.rows.direction, 'up');
  assert.equal(by.rows.delta, 50);
  assert.equal(Math.round(by.rows.pct), 50);
  assert.equal(by.cost.direction, 'same');
  assert.equal(by.cost.delta, 0);
  assert.equal(by.extra.direction, 'new');
  assert.equal(by.note.direction, 'gone');
});

test('a metric that was zero has no percentage rather than infinity', () => {
  const c = compareRuns(run({ metrics: { n: 0 } }), run({ metrics: { n: 5 } }));
  assert.equal(c.metrics[0].delta, 5);
  assert.equal(c.metrics[0].pct, null);
});

test('warnings split into new, gone and still there', () => {
  const a = run({ warningItems: [{ time: 't', msg: 'alpha' }, { time: 't', msg: 'beta' }] });
  const b = run({ warningItems: [{ time: 't', msg: 'beta' }, { time: 't', msg: 'gamma' }] });
  const c = compareRuns(a, b);
  assert.deepEqual(c.warnings.added, ['gamma']);
  assert.deepEqual(c.warnings.resolved, ['alpha']);
  assert.deepEqual(c.warnings.unchanged, ['beta']);
});

test('duration, outcome and touched resources are compared', () => {
  const a = run({ elapsed: 100, success: true, accessed: ['table:a', 'table:b'] });
  const b = run({ elapsed: 150, success: false, accessed: ['table:b', 'file:c'] });
  const c = compareRuns(a, b);
  assert.equal(c.durationDelta, 50);
  assert.equal(Math.round(c.durationPct), 50);
  assert.equal(c.outcomeChanged, true);
  assert.deepEqual(c.touchedAdded, ['file:c']);
  assert.deepEqual(c.touchedRemoved, ['table:a']);
});

test('comparing backwards is reported, not silently reordered', () => {
  const older = run({ date: '2026-09-01T10:00:00' });
  const newer = run({ date: '2026-09-05T10:00:00' });
  assert.equal(compareRuns(older, newer).bIsNewer, true);
  const back = compareRuns(newer, older);
  assert.equal(back.bIsNewer, false);
  assert.equal(back.a, newer, 'the caller\'s order is preserved');
  assert.match(comparisonText(back), /OLDER of the two/);
});

test('different scripts are flagged in the text', () => {
  const c = compareRuns(run({ task: 'A' }), run({ task: 'B' }));
  assert.equal(c.sameTask, false);
  assert.match(comparisonText(c), /different scripts/);
});

test('the default baseline is the previous run of the SAME task', () => {
  const history = [
    run({ task: 'Rec', date: '2026-09-01T10:00:00' }),
    run({ task: 'Other', date: '2026-09-03T10:00:00' }),
    run({ task: 'Rec', date: '2026-09-02T10:00:00' }),
  ];
  const subject = run({ task: 'Rec', date: '2026-09-04T10:00:00' });
  assert.equal(defaultBaseline(subject, history).date, '2026-09-02T10:00:00');
  // A task with no earlier run has no baseline rather than a misleading one.
  assert.equal(defaultBaseline(run({ task: 'New', date: '2026-09-04T10:00:00' }), history), null);
});

test('runs are addressed by id, or task+date when the reporter predates ids', () => {
  const withId = run({ runId: 'abc' });
  const without = run({ task: 'T', date: '2026-09-09T09:00:00' });
  assert.equal(runKey(withId), 'abc');
  assert.equal(runKey(without), 'T|2026-09-09T09:00:00');
  const history = [withId, without];
  assert.equal(findRun(history, 'abc'), withId);
  assert.equal(findRun(history, 'T|2026-09-09T09:00:00'), without);
  assert.equal(findRun(history, 'nope'), null);
});

test('the comparison text states a recovery and a regression plainly', () => {
  assert.match(comparisonText(compareRuns(run({ success: false }), run({ success: true }))), /recovered/);
  assert.match(comparisonText(compareRuns(run({ success: true }), run({ success: false }))), /broke/);
});

// ---------------------------------------------------------------- failure patterns
test('failures group by the category the script gave them, biggest first', () => {
  const hist = [
    run({ success: false, category: 'auth', date: '2026-09-01T10:00:00' }),
    run({ success: false, category: 'auth', date: '2026-09-02T10:00:00' }),
    run({ success: false, category: 'quota', date: '2026-09-03T10:00:00' }),
    run({ success: true, date: '2026-09-04T10:00:00' }),
  ];
  const p = failurePatterns(hist, new Date('2026-09-05T10:00:00'), 30, 20);
  assert.equal(p.failures.length, 3);
  assert.equal(p.groups[0].category, 'auth');
  assert.equal(p.groups[0].count, 2);
  assert.equal(patternText(p), '2 of the last 3 failures were auth');
});

test('one failure is not a pattern, and uncategorised is never the headline', () => {
  const one = failurePatterns([run({ success: false, category: 'auth' })], new Date('2026-09-05T10:00:00'));
  assert.equal(one.dominant, null, 'a single failure is not a pattern');
  assert.equal(patternText(one), null);

  const bare = failurePatterns([
    run({ success: false, date: '2026-09-01T10:00:00' }),
    run({ success: false, date: '2026-09-02T10:00:00' }),
  ], new Date('2026-09-05T10:00:00'));
  assert.equal(bare.dominant, null, 'uncategorised failures are not a named pattern');
  assert.equal(bare.uncategorised, 2);
});

test('failures outside the window are not counted', () => {
  const hist = [
    run({ success: false, category: 'auth', date: '2026-01-01T10:00:00' }),
    run({ success: false, category: 'auth', date: '2026-09-02T10:00:00' }),
  ];
  assert.equal(failurePatterns(hist, new Date('2026-09-05T10:00:00'), 7).failures.length, 1);
});

// ---------------------------------------------------------------- delta pairing
test('two points from one run are paired; unrelated points are not', () => {
  const pts = [
    { date: '2026-09-01T10:00:00', value: 10, task: 'Rec', runId: 'r1' },
    { date: '2026-09-02T10:00:00', value: 26000, task: 'Rec', runId: 'r2' },
    { date: '2026-09-02T10:05:00', value: 0, task: 'Rec', runId: 'r2' },
  ];
  const pairs = withinRunPairs(pts);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].first.value, 26000);
  assert.equal(pairs[0].last.value, 0);
  assert.equal(pairs[0].change, -26000);
});

test('points without a run id cannot be paired and are skipped', () => {
  const pts = [
    { date: '2026-09-01T10:00:00', value: 1, task: 'Rec' },
    { date: '2026-09-01T10:01:00', value: 2, task: 'Rec' },
  ];
  assert.deepEqual(withinRunPairs(pts), []);
});

// ---------------------------------------------------------------- reported 2026-09-04
test('a currency unit goes before the digits and after the minus sign', () => {
  const { formatMetric } = require('../out/logic/sparkline.js');
  const usd = { unit: '$', decimals: 2 };
  assert.equal(formatMetric(-1204.5, usd), '-$1,204.50', 'was "-1,204.50$"');
  assert.equal(formatMetric(4408.67, usd), '$4,408.67', 'was "4,408.67$"');
  assert.equal(formatMetric(0, usd), '$0.00');
  // Non-currency units are unchanged.
  assert.equal(formatMetric(12.5, { unit: '%', decimals: 1 }), '12.5%');
  assert.equal(formatMetric(1200, { unit: 'rows' }), '1,200 rows');
  assert.equal(formatMetric(-5, { unit: '%' }), '-5%');
});
