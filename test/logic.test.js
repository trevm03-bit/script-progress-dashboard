// Unit tests for the pure logic modules. Run with: npm test  (node --test, no VS Code needed)
const test = require('node:test');
const assert = require('node:assert/strict');

const time = require('../out/logic/time.js');
const calendar = require('../out/logic/calendar.js');
const health = require('../out/logic/health.js');
const spark = require('../out/logic/sparkline.js');
const graph = require('../out/logic/graph.js');
const prompts = require('../out/logic/prompts.js');
const fixture = require('./fixtures/data.json');

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

test('liveElapsed and liveEta tick between writes', () => {
  const p = fixture.progress; // elapsed 20 at 10:00:20 -> start 10:00:00
  assert.equal(Math.round(time.liveElapsed(p, NOW)), 30);
  assert.equal(Math.round(time.liveEta(p, NOW)), 5); // eta 15 at 10:00:20, 10 s later
  const done = { ...p, status: 'complete' };
  assert.equal(time.liveElapsed(done, NOW), 20);
  assert.equal(time.liveEta(done, NOW), null);
});

test('taskState: running, stalled, complete, failed, idle', () => {
  const p = fixture.progress;
  assert.equal(time.taskState(null, 30, NOW), 'idle');
  assert.equal(time.taskState(p, 30, NOW), 'running');
  const later = new Date(NOW.getTime() + 31 * 60000);
  assert.equal(time.taskState(p, 30, later), 'stalled');
  assert.equal(time.taskState(p, 60, later), 'running');
  assert.equal(time.taskState({ ...p, status: 'complete' }, 30, later), 'complete');
  assert.equal(time.taskState({ ...p, status: 'failed' }, 30, later), 'failed');
});

test('percent is safe', () => {
  assert.equal(time.percent(3, 7), 43);
  assert.equal(time.percent(0, 0), 0);
  assert.equal(time.percent(9, 7), 100);
});

test('calendar: prefix match is case-insensitive', () => {
  const proc = { name: 'demo pipeline', label: 'x', frequency: 'daily' };
  assert.equal(calendar.matchesProcess('Demo Pipeline Phase 2', proc), true);
  assert.equal(calendar.matchesProcess('Other', proc), false);
});

test('calendar: daily done / pending / overdue', () => {
  const proc = { name: 'Demo Pipeline', label: 'Demo', frequency: 'daily' };
  assert.equal(calendar.processStatus(proc, fixture.history, NOW).status, 'done'); // ran 09:30 today
  const morning = new Date(2026, 8, 3, 9, 0, 0);
  assert.equal(calendar.processStatus(proc, fixture.history, morning).status, 'pending');
  const afternoon = new Date(2026, 8, 3, 13, 0, 0);
  assert.equal(calendar.processStatus(proc, fixture.history, afternoon).status, 'overdue');
});

test('calendar: weekly uses the ISO week', () => {
  const proc = { name: 'Weekly Rollup', label: 'W', frequency: 'weekly' };
  // Ran Mon 2026-08-31; NOW is Wed 2026-09-02 -> same ISO week
  assert.equal(calendar.processStatus(proc, fixture.history, NOW).status, 'done');
  const nextWeek = new Date(2026, 8, 10, 9, 0, 0);          // ran last week -> this week's run pending
  assert.equal(calendar.processStatus(proc, fixture.history, nextWeek).status, 'pending');
  const weekAfter = new Date(2026, 8, 15, 9, 0, 0);         // missed a whole week -> overdue
  assert.equal(calendar.processStatus(proc, fixture.history, weekAfter).status, 'overdue');
  const never = { name: 'Nope', label: 'N', frequency: 'weekly' };
  assert.equal(calendar.processStatus(never, fixture.history, NOW).status, 'overdue');
});

test('calendar: monthly with dayOfMonth and a failed last attempt', () => {
  const proc = { name: 'Month-End Close', label: 'M', frequency: 'monthly', dayOfMonth: 5 };
  const r = calendar.processStatus(proc, fixture.history, NOW); // Sept 2, no Sept run, failed Aug 4
  assert.equal(r.status, 'pending');
  assert.match(r.note, /due by day 5/);
  assert.match(r.note, /last attempt failed/);
  const sept6 = new Date(2026, 8, 6, 9, 0, 0);
  assert.equal(calendar.processStatus(proc, fixture.history, sept6).status, 'overdue');
  const ok = [...fixture.history, { task: 'Month-End Close', date: '2026-09-03T08:00:00', success: true, elapsed: 1, summary: '', warnings: 0 }];
  assert.equal(calendar.processStatus(proc, ok, sept6).status, 'done');
  const noDay = { name: 'Month-End Close', label: 'M', frequency: 'monthly' };
  assert.equal(calendar.processStatus(noDay, fixture.history, sept6).status, 'pending');
});

test('calendar: startOfIsoWeek is Monday', () => {
  assert.equal(calendar.startOfIsoWeek(new Date(2026, 8, 2)).getDay(), 1);
  assert.equal(calendar.startOfIsoWeek(new Date(2026, 8, 6)).getDate(), 31); // Sunday -> previous Monday Aug 31
});

test('health: latest per task and freshness bands', () => {
  const rows = health.healthRows(fixture.history, 24, NOW);
  assert.equal(rows[0].task, 'Demo Pipeline');
  assert.equal(rows[0].runs, 2);
  assert.equal(rows[0].freshness, 'fresh');       // 30 min < 6h
  const weekly = rows.find(r => r.task === 'Weekly Rollup');
  assert.equal(weekly.freshness, 'stale');         // 2 days > 24h
  const monthly = rows.find(r => r.task === 'Month-End Close');
  assert.equal(monthly.failures, 1);
  assert.equal(health.freshness('bad-date', 24, NOW).freshness, 'stale');
  assert.equal(health.freshness(new Date(NOW.getTime() - 10 * 3600000).toISOString(), 24, NOW).freshness, 'aging');
});

test('sparkline: path and stats', () => {
  assert.equal(spark.sparklinePath([], 100, 40), '');
  assert.match(spark.sparklinePath([5], 100, 40), /^M .* L .*$/);
  const path = spark.sparklinePath([0, 10, 5], 100, 40, 0);
  assert.equal(path, 'M 0.0,40.0 L 50.0,0.0 100.0,20.0');
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
});

test('graph: live flags, degrees and the node cap', () => {
  const g = graph.buildGraph(fixture.access, fixture.progress, 150);
  assert.equal(g.activeTask, 'task:Demo Pipeline');
  const live = g.nodes.filter(n => n.live).map(n => n.id).sort();
  assert.deepEqual(live, ['file:input/orders.csv', 'table:crm.customers', 'task:Demo Pipeline']);
  assert.equal(g.edges.filter(e => e.live).length, 2);
  assert.equal(g.nodes.find(n => n.id === 'table:sales.orders_monthly').degree, 2);
  const capped = graph.buildGraph(fixture.access, null, 3);
  assert.equal(capped.nodes.length, 3);
  assert.equal(capped.nodes.filter(n => n.type === 'task').length, 2); // tasks kept first
  assert.equal(capped.dropped, 3);
  for (const e of capped.edges) assert.ok(capped.nodes.some(n => n.id === e.to));
  assert.deepEqual(graph.buildGraph(null, null, 10), { nodes: [], edges: [], activeTask: null, dropped: 0 });
  const s = graph.graphSummary(g);
  assert.deepEqual([s.tasks, s.resources, s.edges], [2, 4, 5]);
});

test('prompts: labels and expansion', () => {
  const cmd = 'run.py --month ${prompt:Month (YYMM)} --again ${prompt:Month (YYMM)} --x ${prompt:}';
  assert.deepEqual(prompts.promptLabels(cmd), ['Month (YYMM)', 'Value']);
  assert.equal(prompts.expandPrompts(cmd, { 'Month (YYMM)': '2609', Value: 'z' }), 'run.py --month 2609 --again 2609 --x z');
  assert.equal(prompts.expandPrompts('plain', {}), 'plain');
});
