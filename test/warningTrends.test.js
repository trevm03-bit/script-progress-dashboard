// Warning Trends: normalisation and grouping, the day buckets, and the markup.
// Run with: node --test test/warningTrends.test.js
const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeWarning, warningTrendsModel } = require('../out/logic/warningTrends.js');
const { renderWarningTrends } = require('../out/render/warningTrends.js');
const { settings } = require('./fixtures/settings.js');
const fixture = require('./fixtures/warnings.json');

// The same pinned clock the other suites use: Wed 2026-09-02 10:00:30 local time.
const NOW = new Date(2026, 8, 2, 10, 0, 30);
const OPTS = { collapsed: false, collapsible: true };

/** settings() plus the warningTrends group (src/settings.ts owns the real defaults). */
const S = (o = {}) => Object.assign(settings(o), {
  warningTrends: { days: 14, top: 5, ...(o.warningTrends || {}) },
});

const model = (data = fixture, s = S()) => warningTrendsModel(data, s, NOW);
const groupNamed = (m, pattern) => m.groups.find(g => g.pattern === pattern);
const render = (data, s, narrow = false) => renderWarningTrends(data, s, NOW, OPTS, narrow);
const ROWS = '# rows had no customer id';

// ---------- normalizeWarning ----------

test('numbers collapse to # so the same warning groups', () => {
  assert.equal(normalizeWarning('12 rows had no id'), '# rows had no id');
  assert.equal(normalizeWarning('28 rows had no id'), '# rows had no id');
  assert.equal(normalizeWarning('2,410 rows'), '# rows');
  assert.equal(normalizeWarning('value 16.2M'), 'value #m');
});

test('whitespace collapses, ends trim, case is folded', () => {
  assert.equal(normalizeWarning('  12 ROWS  had no   id  '), '# rows had no id');
  assert.equal(normalizeWarning('a\n\tb'), 'a b');
});

test('normalizeWarning is total: no input throws, length is capped at 160', () => {
  assert.equal(normalizeWarning(''), '');
  assert.equal(normalizeWarning(undefined), '');
  assert.equal(normalizeWarning(null), '');
  assert.equal(normalizeWarning('a'.repeat(400)).length, 160);
});

// ---------- model ----------

test('only warningItems count — a bare warning count contributes nothing', () => {
  const m = model();
  assert.equal(m.total, 12);
  assert.equal(m.groups.some(g => g.pattern.includes('count only')), false);
  // Month-End Close reports warnings: 5 with no items; only its 08-21 item is counted.
  assert.deepEqual(m.byTask, [
    { task: 'Demo Pipeline', count: 6 },
    { task: 'Weekly Rollup', count: 4 },
    { task: 'Month-End Close', count: 1 },
    { task: 'No Time', count: 1 },
  ]);
});

test('warnings older than the window are excluded', () => {
  const m = model();
  assert.equal(m.groups.some(g => g.pattern === 'ancient warning #'), false);
  assert.equal(m.windowDays, 14);
});

test('per-day buckets are oldest first and split on the local day boundary', () => {
  const m = model();
  assert.equal(m.days.length, 14);
  assert.equal(m.days[0].date, '2026-08-20');
  assert.equal(m.days[0].label, '08-20');
  assert.equal(m.days[13].date, '2026-09-02');
  assert.deepEqual(m.days.map(d => d.count), [0, 1, 2, 0, 0, 0, 0, 0, 0, 0, 1, 2, 2, 4]);
  assert.equal(m.days.reduce((a, d) => a + d.count, 0), m.total);
  // "late night sync 1" at 23:50 and "late night sync 2" at 00:10 land in adjacent buckets.
  const late = groupNamed(m, 'late night sync #');
  assert.equal(late.count, 2);
  assert.equal(late.firstSeen, '2026-09-01T23:50:00');
  assert.equal(late.lastSeen, '2026-09-02T00:10:00');
});

test('an item with no usable time falls back to its run date', () => {
  const m = model(fixture, S({ warningTrends: { top: 10 } }));
  const g = groupNamed(m, 'clock was missing');
  assert.equal(g.count, 1);
  assert.equal(g.firstSeen, '2026-09-02T07:00:00');
});

test('numbers, case and spacing group into one row across tasks', () => {
  const g = groupNamed(model(), ROWS);
  assert.equal(g.count, 4);
  assert.equal(g.example, '12 rows had no customer id', 'the most recent raw message');
  assert.deepEqual(g.tasks, ['Demo Pipeline', 'Weekly Rollup']);
  assert.equal(g.firstSeen, '2026-08-31T08:02:00');
  assert.equal(g.lastSeen, '2026-09-02T09:31:00');
});

test('trend compares the last third of the window with the first', () => {
  const m = model();
  assert.equal(groupNamed(m, ROWS).trend, 'rising', 'all four are in the last four days');
  assert.equal(groupNamed(m, 'disk usage at #%').trend, 'falling', 'both are in the first four days');
  assert.equal(groupNamed(m, 'cache miss for key #').trend, 'flat', 'one at each end');
});

test('groups are biggest first and capped at top', () => {
  const m = model(fixture, S({ warningTrends: { top: 3 } }));
  assert.deepEqual(m.groups.map(g => g.pattern), [ROWS, 'late night sync #', 'cache miss for key #']);
  assert.deepEqual(m.groups.map(g => g.count), [4, 2, 2]);
  assert.equal(m.total, 12, 'the cap trims the list, never the total');
});

test('a shorter window keeps fewer days and fewer warnings', () => {
  const m = model(fixture, S({ warningTrends: { days: 2 } }));
  assert.equal(m.days.length, 2);
  assert.deepEqual(m.days.map(d => d.date), ['2026-09-01', '2026-09-02']);
  assert.equal(m.total, 6);
});

test('an empty window still returns the day scaffold', () => {
  const quiet = { ...fixture, history: fixture.history.filter(r => r.date < '2026-08-10') };
  const m = model(quiet);
  assert.equal(m.total, 0);
  assert.equal(m.days.length, 14);
  assert.deepEqual(m.groups, []);
  assert.deepEqual(m.byTask, []);
});

// ---------- render ----------

test('empty state names the window length', () => {
  const quiet = { ...fixture, history: [] };
  const html = render(quiet, S());
  assert.match(html, /data-section="warningTrends"/);
  assert.match(html, /No warnings in the last 14 days\./);
  assert.equal(html.includes('wt-chart'), false);
});

test('the bar chart has one rect per day, the last highlighted, each with a title', () => {
  const html = render(fixture, S());
  assert.match(html, /<svg class="wt-chart" viewBox="0 0 280 44"/);
  assert.equal((html.match(/<rect class="wt-bar/g) || []).length, 14);
  assert.equal((html.match(/wt-bar-last/g) || []).length, 1);
  assert.match(html, /<title>2026-09-02: 4 warnings<\/title>/);
  assert.match(html, /<title>2026-08-20: 0 warnings<\/title>/);
  assert.match(html, /<title>2026-08-21: 1 warning<\/title>/);
});

test('day labels are shown for the first, middle and last day only', () => {
  const html = render(fixture, S());
  const labels = html.match(/<div class="wt-days muted small">([\s\S]*?)<\/div>/)[1];
  assert.deepEqual([...labels.matchAll(/<span>([\d-]+)<\/span>/g)].map(m => m[1]), ['08-20', '08-26', '09-02']);
});

test('groups show a count badge, the example, task chips, times and a trend arrow', () => {
  const html = render(fixture, S());
  assert.match(html, /<span class="section-aside">12 in 14 days<\/span>/);
  assert.match(html, /<span class="wt-count" title="4 occurrences in this window">4<\/span>/);
  assert.match(html, /<div class="wt-msg" title="# rows had no customer id">12 rows had no customer id<\/div>/);
  assert.match(html, /<span class="chip wt-task"><span class="chip-k">task<\/span><span class="chip-v">Weekly Rollup<\/span><\/span>/);
  assert.match(html, /first 2d ago · last 30m ago/);
  assert.match(html, /<span class="wt-trend wt-rising"[^>]*><i class="codicon codicon-arrow-up"><\/i>rising<\/span>/);
  assert.match(html, /<span class="wt-trend wt-falling"[^>]*><i class="codicon codicon-arrow-down"><\/i>falling<\/span>/);
  assert.match(html, /<span class="wt-trend wt-flat"[^>]*><i class="codicon codicon-arrow-right"><\/i>flat<\/span>/);
});

test('top caps the rendered list', () => {
  assert.equal((render(fixture, S({ warningTrends: { top: 2 } })).match(/class="wt-group"/g) || []).length, 2);
  assert.equal((render(fixture, S({ warningTrends: { top: 6 } })).match(/class="wt-group"/g) || []).length, 6);
});

test('warning text is escaped', () => {
  const html = render(fixture, S({ warningTrends: { top: 6 } }));
  assert.match(html, /Timeout on   API  call &lt;b&gt;x&lt;\/b&gt;/);
  assert.equal(html.includes('<b>x</b>'), false);
});

test('narrow mode drops the chart and shows three groups', () => {
  const html = render(fixture, S(), true);
  assert.equal(html.includes('wt-chart'), false);
  assert.equal(html.includes('wt-days'), false);
  assert.equal((html.match(/class="wt-group"/g) || []).length, 3);
  assert.match(html, /<span class="section-aside">12 in 14 days<\/span>/);
});
