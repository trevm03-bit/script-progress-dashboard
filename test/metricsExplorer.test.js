// Metrics Explorer: the model (ordering, capping, filtering, delta maths) and the markup it
// renders. Run with: node --test test/metricsExplorer.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const { metricsModel } = require('../out/logic/metricsExplorer.js');
const { renderMetricsExplorer } = require('../out/render/metricsExplorer.js');
const { settings } = require('./fixtures/settings.js');
const fixture = require('./fixtures/metrics.json');

// The same pinned clock the other suites use: Wed 2026-09-02 10:00:30 local time.
const NOW = new Date(2026, 8, 2, 10, 0, 30);
const OPTS = { collapsed: false, collapsible: true };

/** settings() plus the metricsExplorer group (src/settings.ts owns the real defaults). */
const S = (o = {}) => Object.assign(settings(o), {
  metricsExplorer: { maxRuns: 5, metrics: [], ...(o.metricsExplorer || {}) },
});

const empty = { ...fixture, history: [] };
const taskNamed = (model, name) => model.tasks.find(t => t.task === name);
const rowNamed = (task, key) => task.rows.find(r => r.key === key);
const render = (data, s, narrow = false) => renderMetricsExplorer(data, s, NOW, OPTS, narrow);

// ---------- model ----------

test('runs are ordered oldest first so a row reads left to right', () => {
  const t = taskNamed(metricsModel(fixture, S()), 'Demo Pipeline');
  assert.deepEqual(t.runs.map(r => r.date), [
    '2026-08-29T09:00:00',
    '2026-08-30T09:00:00',
    '2026-08-31T09:00:00',
    '2026-09-01T09:00:00',
    '2026-09-02T09:30:30',
  ]);
  assert.equal(t.latestDate, '2026-09-02T09:30:30');
  assert.equal(t.runs[1].success, false, 'the 08-30 run failed');
});

test('maxRuns keeps the newest runs, not the oldest', () => {
  const t = taskNamed(metricsModel(fixture, S({ metricsExplorer: { maxRuns: 3 } })), 'Demo Pipeline');
  assert.deepEqual(t.runs.map(r => r.date), [
    '2026-08-31T09:00:00', '2026-09-01T09:00:00', '2026-09-02T09:30:30',
  ]);
  assert.deepEqual(rowNamed(t, 'rows_loaded').values, [4000, 4001, 4200]);
});

test('maxRuns below 1 still shows one run', () => {
  const t = taskNamed(metricsModel(fixture, S({ metricsExplorer: { maxRuns: 0 } })), 'Demo Pipeline');
  assert.equal(t.runs.length, 1);
  assert.equal(t.runs[0].date, '2026-09-02T09:30:30');
});

test('tasks with no metrics at all are skipped; tasks are newest first', () => {
  const model = metricsModel(fixture, S());
  assert.deepEqual(model.tasks.map(t => t.task), ['Demo Pipeline', 'Weekly Rollup', 'Mixed Types']);
  assert.equal(model.taskCount, 3);
  assert.equal(model.metricCount, 6, 'rows_loaded, dupes, total_value, <b>odd</b>, tables, size');
  assert.equal(taskNamed(model, 'Silent Task'), undefined);
});

test('the metric filter narrows keys and drops tasks left with nothing', () => {
  const model = metricsModel(fixture, S({ metricsExplorer: { metrics: ['rows_loaded'] } }));
  assert.deepEqual(model.tasks.map(t => t.task), ['Demo Pipeline']);
  assert.deepEqual(taskNamed(model, 'Demo Pipeline').keys, ['rows_loaded']);
  assert.equal(model.metricCount, 1);
});

test('keys are sorted and values align to the runs, undefined where absent', () => {
  const t = taskNamed(metricsModel(fixture, S()), 'Demo Pipeline');
  assert.deepEqual(t.keys, ['<b>odd</b>', 'dupes', 'rows_loaded', 'total_value']);
  assert.deepEqual(rowNamed(t, 'dupes').values, [4, undefined, 0, undefined, 2]);
  assert.deepEqual(rowNamed(t, '<b>odd</b>').values, [undefined, undefined, undefined, undefined, 7]);
});

test('numeric delta and pct come off the latest two values present', () => {
  const row = rowNamed(taskNamed(metricsModel(fixture, S()), 'Demo Pipeline'), 'rows_loaded');
  assert.equal(row.numeric, true);
  assert.deepEqual(row.series, [3800, 3900, 4000, 4001, 4200]);
  assert.equal(row.latest, 4200);
  assert.equal(row.previous, 4001);
  assert.equal(row.delta, 199);
  assert.ok(Math.abs(row.pct - (199 / 4001) * 100) < 1e-9);
  assert.equal(row.min, 3800);
  assert.equal(row.max, 4200);
});

test('previous = 0 gives a delta but no percentage', () => {
  const row = rowNamed(taskNamed(metricsModel(fixture, S()), 'Demo Pipeline'), 'dupes');
  assert.equal(row.previous, 0, 'the gap at 09-01 is skipped, so previous is the 08-31 zero');
  assert.equal(row.latest, 2);
  assert.equal(row.delta, 2);
  assert.equal(row.pct, null);
});

test('string metrics are text: no series, no delta', () => {
  const row = rowNamed(taskNamed(metricsModel(fixture, S()), 'Demo Pipeline'), 'total_value');
  assert.equal(row.numeric, false);
  assert.deepEqual(row.series, []);
  assert.equal(row.latest, '$16.4M');
  assert.equal(row.previous, '$16.2M');
  assert.equal(row.delta, null);
  assert.equal(row.pct, null);
  assert.equal(row.min, null);
  assert.equal(row.max, null);
});

test('a mixed number/string metric is treated as text', () => {
  const row = rowNamed(taskNamed(metricsModel(fixture, S()), 'Mixed Types'), 'size');
  assert.deepEqual(row.values, [120, 'unknown']);
  assert.equal(row.numeric, false);
  assert.equal(row.delta, null);
});

test('a task with a single run has a value but no previous', () => {
  const t = taskNamed(metricsModel(fixture, S()), 'Weekly Rollup');
  const row = rowNamed(t, 'tables');
  assert.equal(t.runs.length, 1);
  assert.equal(row.latest, 12);
  assert.equal(row.previous, undefined);
  assert.equal(row.delta, null);
  assert.deepEqual(row.series, [12]);
  assert.equal(row.min, 12);
  assert.equal(row.max, 12);
});

test('a key seen only in the newest run has no previous value', () => {
  const row = rowNamed(taskNamed(metricsModel(fixture, S()), 'Demo Pipeline'), '<b>odd</b>');
  assert.equal(row.latest, 7);
  assert.equal(row.previous, undefined);
  assert.equal(row.delta, null);
});

test('an empty history yields no tasks', () => {
  const model = metricsModel(empty, S());
  assert.deepEqual(model.tasks, []);
  assert.equal(model.metricCount, 0);
  assert.equal(model.taskCount, 0);
});

// ---------- render ----------

test('empty state names the reporter call', () => {
  const html = render(empty, S());
  assert.match(html, /data-section="metrics"/);
  assert.match(html, /No metrics yet\. Scripts add them with Progress\.metric\(name, value\)\./);
});

test('the section renders a scrollable table per task with an aside count', () => {
  const html = render(fixture, S());
  assert.match(html, /data-section="metrics"/);
  assert.match(html, /<span class="section-aside">6 metrics · 3 tasks<\/span>/);
  assert.equal((html.match(/class="table-wrap"/g) || []).length, 3);
  assert.equal((html.match(/class="mx-task"/g) || []).length, 3);
  assert.match(html, /Demo Pipeline<\/span><span class="mx-task-meta muted small">5 runs · latest 30m ago/);
  assert.match(html, /Weekly Rollup<\/span><span class="mx-task-meta muted small">1 run · latest /);
});

test('run headers read newest last, carry the full date and flag failures', () => {
  const html = render(fixture, S());
  const heads = [...html.matchAll(/<span class="mx-run-d">([\d-]+)<\/span>/g)].map(m => m[1]);
  assert.deepEqual(heads.slice(0, 5), ['08-29', '08-30', '08-31', '09-01', '09-02']);
  assert.match(html, /class="mx-run mx-run-failed" title="2026-08-30 09:00 · failed · r-0830"/);
  assert.match(html, /title="2026-09-02 09:30 · r-0902"/);
  assert.equal((html.match(/mx-run-failed/g) || []).length, 1, 'only the failed run is red');
});

test('numeric rows get a 60x16 sparkline, text rows do not', () => {
  const html = render(fixture, S());
  // rows_loaded, dupes, <b>odd</b> and tables are numeric; total_value and size are text.
  assert.equal((html.match(/class="mx-spark"/g) || []).length, 4);
  assert.match(html, /<svg class="mx-spark" viewBox="0 0 60 16"[^>]*><path class="sparkline" d="M /);
  const totalValueRow = html.slice(html.indexOf('total_value'), html.indexOf('total_value') + 400);
  assert.equal(totalValueRow.includes('mx-spark'), false);
});

test('cells format numbers, keep strings and mark absent values', () => {
  const html = render(fixture, S());
  assert.match(html, /<td class="mx-val">4,000<\/td>/);
  assert.match(html, /\$16\.4M/);
  assert.match(html, /<span class="mx-absent" title="not reported by this run">—<\/span>/);
});

test('the delta column is signed, carries the pct and classes the direction', () => {
  const html = render(fixture, S());
  assert.match(html, /<td class="mx-delta mx-up" title="previous 4,001">\+199 <span class="mx-pct">\(\+5\.0%\)<\/span><\/td>/);
  // dupes: previous is 0, so there is a delta but no percentage.
  assert.match(html, /<td class="mx-delta mx-up" title="previous 0">\+2<\/td>/);
  // A text metric and a first-ever value both fall back to the flat placeholder.
  assert.match(html, /<td class="mx-delta mx-flat" title="not a numeric change">—<\/td>/);
  assert.match(html, /<td class="mx-delta mx-flat" title="no earlier run reported this metric">—<\/td>/);
});

test('a falling metric is classed mx-down', () => {
  const data = { ...fixture, history: [
    { task: 'T', date: '2026-09-01T09:00:00', success: true, elapsed: 1, summary: '', warnings: 0, metrics: { n: 100 } },
    { task: 'T', date: '2026-09-02T09:00:00', success: true, elapsed: 1, summary: '', warnings: 0, metrics: { n: 75 } },
  ] };
  assert.match(render(data, S()), /<td class="mx-delta mx-down" title="previous 100">-25 <span class="mx-pct">\(-25\.0%\)<\/span><\/td>/);
});

test('an unchanged metric is classed mx-flat', () => {
  const data = { ...fixture, history: [
    { task: 'T', date: '2026-09-01T09:00:00', success: true, elapsed: 1, summary: '', warnings: 0, metrics: { n: 100 } },
    { task: 'T', date: '2026-09-02T09:00:00', success: true, elapsed: 1, summary: '', warnings: 0, metrics: { n: 100 } },
  ] };
  assert.match(render(data, S()), /<td class="mx-delta mx-flat" title="previous 100">0 <span class="mx-pct">\(0\.0%\)<\/span><\/td>/);
});

test('metric keys and task names are escaped', () => {
  const html = render(fixture, S());
  assert.match(html, /&lt;b&gt;odd&lt;\/b&gt;/);
  assert.equal(html.includes('<b>odd</b>'), false);
});

test('narrow mode shows only the latest value and the delta', () => {
  const html = render(fixture, S(), true);
  assert.match(html, /<th class="mx-run">Latest<\/th>/);
  assert.equal(html.includes('mx-run-d'), false, 'no per-run columns');
  assert.equal(html.includes('mx-run-failed'), false);
  assert.match(html, /<td class="mx-val mx-val-latest">4,200<\/td>/);
  assert.match(html, /Δ vs prev/);
  // One value column plus the delta column for every metric row.
  assert.equal((html.match(/class="mx-val mx-val-latest"/g) || []).length, 6);
});
