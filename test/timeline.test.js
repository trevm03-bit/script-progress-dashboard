// Run Timeline: window maths and lanes (logic) plus the markup that reaches the webview.
const test = require('node:test');
const assert = require('node:assert/strict');

const { timelineModel, timelineTicks, tickStepHours, windowHoursOf } = require('../out/logic/timeline.js');
const { renderTimeline, windowText } = require('../out/render/timeline.js');
const fixture = require('./fixtures/timeline.json');
const { settings } = require('./fixtures/settings.js');

// Wed 2026-09-02 10:00:30 local — the same pinned clock the other suites use.
const NOW = new Date(2026, 8, 2, 10, 0, 30);
const HOUR = 3600 * 1000;

/** The shared fixture settings plus the timeline/anomaly keys it predates. */
function S(o = {}) {
  const s = settings(o);
  s.timeline = Object.assign({ windowHours: 24, showFailed: true }, o.timeline || {});
  s.runHistory = Object.assign({}, s.runHistory, { anomalies: false, anomalyFactor: 2 }, o.runHistory || {});
  return s;
}

const empty = { progress: null, tasks: [], history: [], deltas: {}, access: null, overlays: [], logsDir: 'x', logsDirExists: true, readErrors: [] };
const lane = (m, task) => m.lanes.find(l => l.task === task);

test('window is windowHours long and ends at now; bad values fall back to 24h', () => {
  const m = timelineModel(fixture, S(), NOW);
  assert.equal(m.end.getTime(), NOW.getTime());
  assert.equal(m.start.getTime(), NOW.getTime() - 24 * HOUR);
  assert.equal(m.windowHours, 24);
  assert.equal(windowHoursOf({ timeline: { windowHours: 0 } }), 24);
  assert.equal(windowHoursOf({}), 24);
  assert.equal(windowHoursOf({ timeline: { windowHours: 168 } }), 168);
});

test('bars come from history and from a running task', () => {
  const m = timelineModel(fixture, S(), NOW);

  // A finished run: start = startedAt, end = date.
  const demo = lane(m, 'Demo Pipeline');
  const big = demo.bars.find(b => b.seconds === 120);
  assert.equal(big.running, false);
  assert.equal(big.success, true);
  assert.equal(big.start.getTime(), new Date(2026, 8, 2, 7, 58, 0).getTime());
  assert.equal(big.end.getTime(), new Date(2026, 8, 2, 8, 0, 0).getTime());
  assert.equal(big.run.summary, 'four times the usual');
  assert.equal(big.task, undefined);

  // Without startedAt the start is derived from date - elapsed.
  const derived = demo.bars.find(b => b.end.getTime() === new Date(2026, 8, 1, 22, 0, 0).getTime());
  assert.equal(derived.start.getTime(), new Date(2026, 8, 1, 22, 0, 0).getTime() - 30000);

  // The running task ends at now and is measured with liveElapsed (09:55:00 -> 10:00:30).
  const live = lane(m, 'Nightly Sync').bars.find(b => b.running);
  assert.equal(live.end.getTime(), NOW.getTime());
  assert.equal(live.start.getTime(), new Date(2026, 8, 2, 9, 55, 0).getTime());
  assert.equal(Math.round(live.seconds), 330);
  assert.equal(live.x1, 1);
  assert.equal(live.task.status, 'running');
  assert.equal(live.run, undefined);

  // A task that is NOT running contributes no live bar (its history row still does).
  assert.equal(demo.bars.filter(b => b.running).length, 0);

  // Lanes are ordered by most recent activity: the running task is first.
  assert.equal(m.lanes[0].task, 'Nightly Sync');
  assert.equal(m.lanes[0].running, true);
  assert.equal(m.runs, 11);
  assert.equal(m.running, 1);
  assert.equal(m.failures, 1);
});

test('bars are clipped to the window and runs longer than it survive', () => {
  const m = timelineModel(fixture, S(), NOW);

  const edge = lane(m, 'Edge Job').bars[0];
  assert.equal(edge.clippedStart, true);
  assert.equal(edge.clippedEnd, false);
  assert.equal(edge.x0, 0);
  // The true times are kept even though the drawing is clipped.
  assert.equal(edge.start.getTime(), new Date(2026, 8, 1, 9, 30, 0).getTime());
  assert.equal(edge.seconds, 5400);
  // Ends 11:00, window opens 10:00:30 -> 59.5 of the window's 1440 minutes are used.
  assert.ok(Math.abs(edge.x1 - (59.5 * 60 * 1000) / (24 * HOUR)) < 1e-9);

  // A two-day run inside a one-day window: clipped at the left, still visible.
  const long = lane(m, 'Long Job').bars[0];
  assert.equal(long.clippedStart, true);
  assert.equal(long.x0, 0);
  assert.equal(long.seconds, 172800);
  assert.ok(long.x1 > 0.8 && long.x1 < 0.84);
});

test('runs entirely outside the window are dropped', () => {
  const m = timelineModel(fixture, S(), NOW);
  assert.equal(lane(m, 'Weekly Rollup'), undefined); // ended 09:00, window opens 10:00:30
  assert.ok(m.lanes.every(l => l.bars.every(b => b.x1 > 0 || b.x0 < 1)));

  // Shrink the window and only the newest runs remain.
  const short = timelineModel(fixture, S({ timeline: { windowHours: 1 } }), NOW);
  assert.deepEqual(short.lanes.map(l => l.task), ['Nightly Sync']);
});

test('overlapping runs of different tasks land in different lanes and overlap on the axis', () => {
  const m = timelineModel(fixture, S(), NOW);
  const a = lane(m, 'Overlap A').bars[0];
  const b = lane(m, 'Overlap B').bars[0];
  assert.notEqual(lane(m, 'Overlap A'), lane(m, 'Overlap B'));
  assert.ok(a.start < b.start && b.start < a.end && a.end < b.end, 'B starts inside A');
  assert.ok(b.x0 < a.x1 && a.x0 < b.x1, 'the drawn ranges intersect');
});

test('per-lane totals: runs, failures, seconds and busiest', () => {
  const m = timelineModel(fixture, S(), NOW);
  const demo = lane(m, 'Demo Pipeline');
  assert.equal(demo.runs, 4);
  assert.equal(demo.failures, 0);
  assert.equal(demo.totalSeconds, 30 + 30 + 30 + 120);
  assert.equal(demo.busiest.seconds, 120);

  const sync = lane(m, 'Nightly Sync');
  assert.equal(sync.runs, 2);
  assert.equal(sync.failures, 1);

  // windowSeconds counts only the part inside the window; totalSeconds is the true duration.
  const long = lane(m, 'Long Job');
  assert.equal(long.totalSeconds, 172800);
  assert.ok(long.windowSeconds < 24 * 3600 && long.windowSeconds > 71000);
});

test('showFailed:false hides failed runs', () => {
  const m = timelineModel(fixture, S({ timeline: { windowHours: 24, showFailed: false } }), NOW);
  assert.equal(m.failures, 0);
  assert.equal(lane(m, 'Nightly Sync').runs, 1); // only the live bar is left
});

test('ticks: hourly for 24h, six-hourly for 168h', () => {
  const m24 = timelineModel(fixture, S(), NOW);
  assert.equal(m24.stepHours, 1);
  assert.equal(tickStepHours(24), 1);
  assert.equal(m24.ticks.length, 24); // 11:00 on the 1st through 10:00 on the 2nd
  assert.equal(m24.ticks[0].at.getHours(), 11);
  assert.equal(m24.ticks[m24.ticks.length - 1].at.getHours(), 10);
  assert.ok(m24.ticks.every(t => t.at.getMinutes() === 0 && t.x >= 0 && t.x <= 1));
  assert.ok(m24.ticks.every(t => t.at >= m24.start && t.at <= m24.end));
  // Only every third hour is labelled, and midnight is the major tick.
  assert.deepEqual(m24.ticks.filter(t => t.label).map(t => t.at.getHours()), [12, 15, 18, 21, 0, 3, 6, 9]);
  assert.equal(m24.ticks.filter(t => t.major).length, 1);
  assert.equal(m24.ticks.find(t => t.major).label, '2 Sep');

  const m168 = timelineModel(fixture, S({ timeline: { windowHours: 168 } }), NOW);
  assert.equal(m168.stepHours, 6);
  assert.equal(tickStepHours(168), 6);
  assert.equal(tickStepHours(24 * 30), 24);
  assert.ok(m168.ticks.length >= 27 && m168.ticks.length <= 29);
  assert.ok(m168.ticks.every(t => t.at.getHours() % 6 === 0));
  for (let i = 1; i < m168.ticks.length; i++) {
    assert.equal(m168.ticks[i].at.getTime() - m168.ticks[i - 1].at.getTime(), 6 * HOUR);
  }
  assert.ok(m168.ticks.filter(t => t.label).every(t => t.at.getHours() % 12 === 0));

  assert.deepEqual(timelineTicks(NOW, NOW, 24), []); // zero-length window
});

test('empty history and a single run', () => {
  const m = timelineModel(empty, S(), NOW);
  assert.deepEqual(m.lanes, []);
  assert.equal(m.runs, 0);
  assert.equal(m.ticks.length, 24);

  const one = { ...empty, history: [{ task: 'Solo', date: '2026-09-02T09:00:00', success: true, elapsed: 60, summary: '', warnings: 0 }] };
  const m1 = timelineModel(one, S(), NOW);
  assert.equal(m1.lanes.length, 1);
  assert.equal(m1.lanes[0].bars.length, 1);
  assert.equal(m1.lanes[0].bars[0].slow, false);
});

test('slow flag needs anomalies on, 3 priors and factor x median', () => {
  const off = timelineModel(fixture, S(), NOW);
  assert.ok(lane(off, 'Demo Pipeline').bars.every(b => !b.slow), 'anomalies off -> never slow');

  const on = timelineModel(fixture, S({ runHistory: { anomalies: true, anomalyFactor: 2 } }), NOW);
  const bars = lane(on, 'Demo Pipeline').bars;
  const slow = bars.filter(b => b.slow);
  assert.equal(slow.length, 1);
  assert.equal(slow[0].seconds, 120); // 4x the 30s median of its 3 priors
  // The three priors themselves have too little history behind them to be judged.
  assert.ok(bars.filter(b => b.seconds === 30).every(b => !b.slow));

  const strict = timelineModel(fixture, S({ runHistory: { anomalies: true, anomalyFactor: 5 } }), NOW);
  assert.ok(lane(strict, 'Demo Pipeline').bars.every(b => !b.slow), '4x is under a 5x factor');
});

test('overSla flag comes from the matching process maxMinutes', () => {
  const s = S({ processes: [{ name: 'Overlap A', label: 'A', frequency: 'daily', maxMinutes: 10 }] });
  const m = timelineModel(fixture, s, NOW);
  assert.equal(lane(m, 'Overlap A').bars[0].overSla, true); // 30 minutes against a 10 minute SLA
  assert.equal(lane(m, 'Overlap B').bars[0].overSla, false);

  // A live run trips the SLA on its live elapsed, not the last written figure.
  const live = S({ processes: [{ name: 'Nightly Sync', label: 'N', frequency: 'daily', maxMinutes: 5 }] });
  assert.equal(timelineModel(fixture, live, NOW).lanes[0].bars.find(b => b.running).overSla, true);
  const lax = S({ processes: [{ name: 'Nightly Sync', label: 'N', frequency: 'daily', maxMinutes: 60 }] });
  assert.equal(timelineModel(fixture, lax, NOW).lanes[0].bars.find(b => b.running).overSla, false);
});

// ---- markup ----

const trackCount = html => (html.match(/<div class="tl-track">/g) || []).length;

test('renders one undistorted track per lane, with bars, ticks and a now line', () => {
  const html = renderTimeline(fixture, S({ runHistory: { anomalies: true } }), NOW, {}, false);
  assert.match(html, /data-section="timeline"/);
  assert.match(html, /Run Timeline/);
  assert.equal(trackCount(html), 7);
  // Bars are SVG rects only — no <text> inside the stretched viewBox.
  assert.match(html, /<svg class="tl-bars" viewBox="0 0 1000 24" preserveAspectRatio="none"/);
  assert.doesNotMatch(html, /<text/);
  assert.match(html, /class="tl-bar tl-bar-running"/);
  assert.match(html, /tl-bar tl-bar-ok/);
  assert.match(html, /tl-bar tl-bar-fail/);
  assert.match(html, /tl-bar-slow/);
  // Tick labels are HTML positioned by percentage.
  assert.match(html, /<span class="tl-tick-lbl tl-lbl-half" style="left:[\d.]+%">12:00<\/span>/);
  assert.match(html, /class="tl-now-lbl">now</);
  // Native tooltip per bar.
  assert.match(html, /<title>Overlap A · 07:00–07:30 · 30m · ok<\/title>/);
  assert.match(html, /<title>Nightly Sync · 09:55–10:00 · 5m30s · running<\/title>/);
  // A bar crossing midnight (or a window longer than a day) carries the date too.
  assert.match(html, /<title>Long Job · 2026-08-31 06:00–2026-09-02 06:00 · 48h · ok<\/title>/);
  // Per-lane totals.
  assert.match(html, /<div class="tl-tot muted">4 runs · 3m30s<\/div>/);
  assert.match(html, /2 runs · 1 failed ·/);
  // Aside: window, run count, failures in the failure colour.
  assert.match(html, /last 24h · 11 runs/);
  assert.match(html, /<span class="status-fail">· 1 failed<\/span>/);
});

test('narrow mode caps the lanes and drops the totals column', () => {
  const html = renderTimeline(fixture, S(), NOW, {}, true);
  assert.equal(trackCount(html), 6);
  assert.match(html, /class="tl-grid tl-narrow"/);
  assert.doesNotMatch(html, /class="tl-tot muted"/);
  assert.match(html, /\+1 more task</);
  // The lanes kept are the most recent ones.
  assert.match(html, /title="Nightly Sync"/);
  assert.doesNotMatch(html, /title="Edge Job"/);
});

test('every user string is escaped', () => {
  const html = renderTimeline(fixture, S(), NOW, {}, false);
  assert.match(html, /&lt;b&gt;Bad Task&lt;\/b&gt;/);
  assert.doesNotMatch(html, /<b>Bad Task/);
  assert.equal((html.match(/<b>/g) || []).length, 0);
});

test('empty state names the window', () => {
  assert.match(renderTimeline(empty, S(), NOW, {}, false), /No runs in the last 24 hours\./);
  assert.match(renderTimeline(empty, S({ timeline: { windowHours: 168 } }), NOW, {}, false), /No runs in the last 7 days\./);
  assert.match(renderTimeline(empty, S({ timeline: { windowHours: 6 } }), NOW, {}, false), /No runs in the last 6 hours\./);
  assert.equal(windowText(1), '1 hour');
  assert.equal(windowText(0.5), '30 minutes');
});
