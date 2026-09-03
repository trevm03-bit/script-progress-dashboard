// Unit tests for the pure logic modules. Run with: npm test  (node --test, no VS Code needed)
const test = require('node:test');
const assert = require('node:assert/strict');

const time = require('../out/logic/time.js');
const calendar = require('../out/logic/calendar.js');
const health = require('../out/logic/health.js');
const spark = require('../out/logic/sparkline.js');
const graph = require('../out/logic/graph.js');
const prompts = require('../out/logic/prompts.js');
const summary = require('../out/logic/summary.js');
const fixture = require('./fixtures/data.json');
const { settings } = require('./fixtures/settings.js');

// A fixed "now" for every test: Wed 2026-09-02 10:00:30 local time.
const NOW = new Date(2026, 8, 2, 10, 0, 30);

test('formatDuration', () => {
  assert.equal(time.formatDuration(0), '0s');
  assert.equal(time.formatDuration(45.4), '45s');
  assert.equal(time.formatDuration(125), '2m5s');
  assert.equal(time.formatDuration(120), '2m');
  assert.equal(time.formatDuration(3600), '1h');
  assert.equal(time.formatDuration(7261), '2h1m');
  assert.equal(time.formatDuration(-5), '0s');
  assert.equal(time.formatDuration(NaN), '0s');
});

test('relativeTime', () => {
  assert.equal(time.relativeTime(null, NOW), 'never');
  assert.equal(time.relativeTime('garbage', NOW), 'never');
  assert.equal(time.relativeTime(new Date(NOW.getTime() - 10000).toISOString(), NOW), 'just now');
  assert.equal(time.relativeTime(new Date(NOW.getTime() - 5 * 60000).toISOString(), NOW), '5m ago');
  assert.equal(time.relativeTime(new Date(NOW.getTime() - 3 * 3600000).toISOString(), NOW), '3h ago');
  assert.equal(time.relativeTime(new Date(NOW.getTime() - 3 * 86400000).toISOString(), NOW), '3d ago');
  assert.equal(time.relativeTime(new Date(NOW.getTime() - 21 * 86400000).toISOString(), NOW), '3w ago');
});

test('liveElapsed prefers startedAt; liveEta ticks between writes', () => {
  const p = fixture.progress; // startedAt 10:00:00 -> 30 s at NOW
  assert.equal(Math.round(time.liveElapsed(p, NOW)), 30);
  assert.equal(Math.round(time.liveEta(p, NOW)), 5);
  const noStart = { ...p, startedAt: undefined }; // derived from updatedAt - elapsed = 10:00:00 too
  assert.equal(Math.round(time.liveElapsed(noStart, NOW)), 30);
  const done = { ...p, status: 'complete' };
  assert.equal(time.liveElapsed(done, NOW), 20);
  assert.equal(time.liveEta(done, NOW), null);
});

test('taskState: running, stalled, exited (overlay), complete, failed, idle', () => {
  const p = fixture.progress;
  assert.equal(time.taskState(null, 30, NOW), 'idle');
  assert.equal(time.taskState(p, 30, NOW), 'running');
  const later = new Date(NOW.getTime() + 31 * 60000);
  assert.equal(time.taskState(p, 30, later), 'stalled');
  assert.equal(time.taskState(p, 60, later), 'running');
  assert.equal(time.taskState({ ...p, status: 'complete' }, 30, later), 'complete');
  assert.equal(time.taskState({ ...p, status: 'failed' }, 30, later), 'failed');
  const overlays = [{ task: 'Demo Pipeline', exitCode: 1, when: '2026-09-02T10:00:25' }];
  assert.equal(time.taskState(p, 30, NOW, overlays), 'exited');
  const stale = [{ task: 'Demo Pipeline', exitCode: 1, when: '2026-09-02T09:00:00' }]; // before this run started
  assert.equal(time.taskState(p, 30, NOW, stale), 'running');
  assert.equal(time.taskState(p, 30, NOW, [{ task: 'Other', exitCode: 1, when: '2026-09-02T10:00:25' }]), 'running');
});

test('percent with and without substep; slug', () => {
  assert.equal(time.percent(3, 7), 43);
  assert.equal(time.percent(3, 7, 0.5), 36);   // 2.5 of 7
  assert.equal(time.percent(0, 0), 0);
  assert.equal(time.percent(9, 7), 100);
  assert.equal(time.slug('Nightly Load 2'), 'nightly-load-2');
  assert.equal(time.slug('  '), 'task');
});

test('calendar: prefix match is case-insensitive', () => {
  const proc = { name: 'demo pipeline', label: 'x', frequency: 'daily' };
  assert.equal(calendar.matchesProcess('Demo Pipeline Phase 2', proc), true);
  assert.equal(calendar.matchesProcess('Other', proc), false);
});

test('calendar: daily done / pending / overdue with dueHour', () => {
  const proc = { name: 'Demo Pipeline', label: 'Demo', frequency: 'daily' };
  assert.equal(calendar.processStatus(proc, fixture.history, NOW).status, 'done'); // ran 09:30 today
  const morning = new Date(2026, 8, 3, 9, 0, 0);
  assert.equal(calendar.processStatus(proc, fixture.history, morning).status, 'pending');
  const afternoon = new Date(2026, 8, 3, 13, 0, 0);
  assert.equal(calendar.processStatus(proc, fixture.history, afternoon).status, 'overdue');
  const early = { ...proc, dueHour: 8 };
  assert.equal(calendar.processStatus(early, fixture.history, morning).status, 'overdue');
});

test('calendar: weekly uses the ISO week and dayOfWeek', () => {
  const proc = { name: 'Weekly Rollup', label: 'W', frequency: 'weekly' };
  assert.equal(calendar.processStatus(proc, fixture.history, NOW).status, 'done'); // Mon Aug 31 = same week
  const nextWeek = new Date(2026, 8, 10, 9, 0, 0);
  assert.equal(calendar.processStatus(proc, fixture.history, nextWeek).status, 'pending');
  const weekAfter = new Date(2026, 8, 15, 9, 0, 0);
  assert.equal(calendar.processStatus(proc, fixture.history, weekAfter).status, 'overdue');
  const byWed = { ...proc, dayOfWeek: 3 };
  assert.equal(calendar.processStatus(byWed, fixture.history, new Date(2026, 8, 10, 9)).status, 'overdue'); // Thu, missed Wed
  assert.equal(calendar.processStatus({ name: 'Nope', label: 'N', frequency: 'weekly' }, fixture.history, NOW).status, 'overdue');
});

test('calendar: monthly with dayOfMonth, failed last attempt, and nextDue', () => {
  const proc = { name: 'Month-End Close', label: 'M', frequency: 'monthly', dayOfMonth: 5 };
  const r = calendar.processStatus(proc, fixture.history, NOW);
  assert.equal(r.status, 'pending');
  assert.match(r.note, /due by day 5/);
  assert.match(r.note, /last attempt failed/);
  assert.equal(r.nextDue.getDate(), 5);
  assert.equal(r.nextDue.getMonth(), 8);
  const sept6 = new Date(2026, 8, 6, 9, 0, 0);
  assert.equal(calendar.processStatus(proc, fixture.history, sept6).status, 'overdue');
  const ok = [...fixture.history, { task: 'Month-End Close', date: '2026-09-03T08:00:00', success: true, elapsed: 1, summary: '', warnings: 0 }];
  const done = calendar.processStatus(proc, ok, sept6);
  assert.equal(done.status, 'done');
  assert.equal(done.nextDue.getMonth(), 9); // next month
  assert.equal(calendar.processStatus({ name: 'Month-End Close', label: 'M', frequency: 'monthly' }, fixture.history, sept6).status, 'pending');
});

test('calendar: month grid and due text', () => {
  const proc = { name: 'Demo Pipeline', label: 'Demo', frequency: 'monthly', dayOfMonth: 5 };
  const cells = calendar.monthGrid(proc, fixture.history, NOW);
  assert.equal(cells.length, 30); // September
  assert.equal(cells[0].state, 'ok');    // Sept 1 run
  assert.equal(cells[1].state, 'ok');    // Sept 2 run (09:30)
  assert.equal(cells[1].today, true);
  assert.equal(cells[4].due, true);
  assert.equal(cells[5].state, 'future');
  const failGrid = calendar.monthGrid({ name: 'Month-End Close', label: 'x', frequency: 'monthly' }, fixture.history, new Date(2026, 7, 10));
  assert.equal(failGrid[3].state, 'fail'); // Aug 4
  assert.equal(calendar.dueText(new Date(NOW.getTime() + 30 * 60000), NOW), 'due in 30m');
  assert.equal(calendar.dueText(new Date(2026, 8, 2, 14, 0), NOW), 'due in 4h');
  assert.equal(calendar.dueText(new Date(2026, 8, 3, 12, 0), NOW), 'due tomorrow');
  assert.equal(calendar.dueText(new Date(2026, 8, 5, 23, 59), NOW), 'due 5 Sep');
  assert.equal(calendar.dueText(new Date(2026, 8, 1), NOW), 'overdue');
  assert.equal(calendar.startOfIsoWeek(new Date(2026, 8, 6)).getDate(), 31);
});

test('health: rows with dots, failure rate, durations and freshness', () => {
  const rows = health.healthRows(fixture.history, 24, NOW, 5);
  assert.equal(rows[0].task, 'Demo Pipeline');
  assert.equal(rows[0].runs, 2);
  assert.deepEqual(rows[0].recent, [true, true]);
  assert.equal(rows[0].failureRate, 0);
  assert.deepEqual(rows[0].durations, [38.2, 35]);
  assert.equal(Math.round(rows[0].avgDuration * 10) / 10, 36.6);
  assert.equal(rows[0].freshness, 'fresh');
  const monthly = rows.find(r => r.task === 'Month-End Close');
  assert.equal(monthly.failureRate, 1);
  assert.deepEqual(monthly.recent, [false]);
  assert.equal(rows.find(r => r.task === 'Weekly Rollup').freshness, 'stale');
  assert.equal(health.freshness('bad-date', 24, NOW).freshness, 'stale');
  assert.equal(health.freshness(new Date(NOW.getTime() - 10 * 3600000).toISOString(), 24, NOW).freshness, 'aging');
});

test('sparkline: path, stats, formats, thresholds', () => {
  assert.equal(spark.sparklinePath([], 100, 40), '');
  assert.match(spark.sparklinePath([5], 100, 40), /^M .* L .*$/);
  assert.equal(spark.sparklinePath([0, 10, 5], 100, 40, 0), 'M 0.0,40.0 L 50.0,0.0 100.0,20.0');
  const s = spark.seriesStats([3900, 3950, 4001]);
  assert.equal(s.trend, 'up');
  assert.equal(s.change, 101);
  assert.equal(spark.seriesStats([1, 1, 1]).trend, 'flat');
  assert.equal(spark.seriesStats([5, 2]).trend, 'down');
  assert.equal(spark.seriesStats([]), null);
  assert.equal(spark.formatMetric(15200000), '15.2M');
  assert.equal(spark.formatMetric(4001), '4,001');
  assert.equal(spark.formatMetric(0.004), '0');
  assert.equal(spark.formatMetric(-0.25), '-0.25');
  assert.equal(spark.formatMetric(0.1234, { decimals: 2, unit: '%' }), '0.12%');
  assert.equal(spark.formatMetric(1500, { unit: 'rows' }), '1,500 rows');
  assert.equal(spark.outOfRange(0.7, { min: -0.5, max: 0.5 }), true);
  assert.equal(spark.outOfRange(0.2, { min: -0.5, max: 0.5 }), false);
  assert.equal(spark.outOfRange(0.2, undefined), false);
  assert.equal(spark.sparklineY([0, 10], 5, 40, 0), 20);
});

test('graph: live flags, degrees, reads/writes, cap, time window', () => {
  const g = graph.buildGraph(fixture.access, fixture.tasks, 150, 0, NOW);
  assert.deepEqual(g.activeTasks, ['task:Demo Pipeline']);
  const live = g.nodes.filter(n => n.live).map(n => n.id).sort();
  assert.deepEqual(live, ['file:input/orders.csv', 'table:crm.customers', 'task:Demo Pipeline']);
  assert.equal(g.edges.filter(e => e.live).length, 2);
  const monthly = g.nodes.find(n => n.id === 'table:sales.orders_monthly');
  assert.equal(monthly.degree, 2);
  assert.equal(monthly.writes, 4);
  assert.equal(monthly.reads, 2);
  const capped = graph.buildGraph(fixture.access, [], 3, 0, NOW);
  assert.equal(capped.nodes.length, 3);
  assert.equal(capped.nodes.filter(n => n.type === 'task').length, 2);
  assert.equal(capped.dropped, 3);
  const windowed = graph.buildGraph(fixture.access, [], 150, 1, NOW); // last 24h only (orders_monthly was 25h ago)
  assert.deepEqual(windowed.nodes.map(n => n.id).sort(), ['file:input/orders.csv', 'table:crm.customers', 'task:Demo Pipeline']);
  assert.equal(windowed.dropped, 3);
  assert.deepEqual(graph.buildGraph(null, [], 10), { nodes: [], edges: [], activeTasks: [], dropped: 0 });
  const s = graph.graphSummary(g);
  assert.deepEqual([s.tasks, s.resources, s.edges], [2, 4, 5]);
});

test('prompts: labels and expansion', () => {
  const cmd = 'run.py --month ${prompt:Month (YYMM)} --again ${prompt:Month (YYMM)} --x ${prompt:}';
  assert.deepEqual(prompts.promptLabels(cmd), ['Month (YYMM)', 'Value']);
  assert.equal(prompts.expandPrompts(cmd, { 'Month (YYMM)': '2609', Value: 'z' }), 'run.py --month 2609 --again 2609 --x z');
  assert.equal(prompts.expandPrompts('plain', {}), 'plain');
});

test('summary facts, daily text and CSV', () => {
  const s = settings({ deltas: { thresholds: { reconciliation_delta: { min: -0.5, max: 0.5 } }, formats: {}, points: 50 } });
  const f = summary.summaryFacts(fixture, s, NOW);
  assert.equal(f.runningCount, 1);
  assert.equal(f.runsToday, 1);
  assert.equal(f.failedToday, 0);
  assert.deepEqual(f.overdue, []);
  assert.equal(f.nextDue.label, 'Demo');          // daily, done today -> due tomorrow, sooner than Close on the 5th
  assert.equal(f.nextDue.text, 'due tomorrow');
  assert.deepEqual(f.staleScripts, ['Weekly Rollup', 'Month-End Close']);
  assert.deepEqual(f.metricsOutOfRange, []);
  const text = summary.dailySummaryText(fixture, s, NOW);
  assert.match(text, /Runs today: 1 \(0 failed, 0 warnings\)/);
  assert.match(text, /OK +09:30 Demo Pipeline · 35s · INSERT: 3,990 rows & more · rows_loaded=3,990, total_value=\$16.2M/);
  assert.match(text, /Calendar: nothing overdue · next: Demo due tomorrow/);
  const csv = summary.historyCsv(fixture.history);
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], 'date,task,success,elapsed_seconds,warnings,summary,run_id,started_at,rows_loaded,total_value');
  assert.equal(lines.length, 5);
  assert.match(lines[4], /"INSERT: 3,990 rows & more"/);
});
