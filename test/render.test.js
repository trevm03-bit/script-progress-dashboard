// Rendering tests: the HTML that reaches the webview, checked from fixture data.
const test = require('node:test');
const assert = require('node:assert/strict');

const { renderSections } = require('../out/render/dashboard.js');
const { esc } = require('../out/render/html.js');
const fixture = require('./fixtures/data.json');

const NOW = new Date(2026, 8, 2, 10, 0, 30);

function settings(overrides = {}) {
  return {
    logsPath: 'logs',
    refreshInterval: 2000,
    staleRunningMinutes: 30,
    statusBarEnabled: true,
    sections: {
      activeTask: true, warnings: true, lastCompleted: true, runHistory: true,
      processCalendar: true, quickActions: true, deltaTracker: true, scriptHealth: true, accessMap: true,
      ...(overrides.sections || {}),
    },
    runHistoryMaxRows: 15,
    processes: [
      { name: 'Demo Pipeline', label: 'Demo', frequency: 'daily' },
      { name: 'Month-End Close', label: 'Close', frequency: 'monthly', dayOfMonth: 5 },
    ],
    buttons: [
      { label: 'Run <it>', command: 'python x.py --m ${prompt:Month}', icon: 'play', group: 'Ops' },
      { label: 'No confirm', command: 'echo hi', confirm: false },
    ],
    deltaMetrics: [],
    staleHours: 24,
    accessMapMaxNodes: 150,
    ...overrides,
    sections: undefined,
  };
}
// (sections merged above; drop the undefined key)
function S(o = {}) { const s = settings(o); s.sections = { activeTask: true, warnings: true, lastCompleted: true, runHistory: true, processCalendar: true, quickActions: true, deltaTracker: true, scriptHealth: true, accessMap: true, ...(o.sections || {}) }; return s; }

const ctx = (surface = 'panel', trusted = true) => ({ now: NOW, surface, trusted });

test('esc escapes everything that matters', () => {
  assert.equal(esc(`<a href="x">Tom's & co</a>`), '&lt;a href=&quot;x&quot;&gt;Tom&#39;s &amp; co&lt;/a&gt;');
  assert.equal(esc(null), '');
});

test('every enabled section appears once, in the spec order', () => {
  const html = renderSections(fixture, S(), ctx());
  const order = [...html.matchAll(/data-section="([a-zA-Z]+)"/g)].map(m => m[1]);
  assert.deepEqual(order, ['activeTask', 'warnings', 'lastCompleted', 'quickActions', 'processCalendar', 'deltaTracker', 'runHistory', 'scriptHealth', 'accessMap']);
});

test('disabled sections are absent; all off shows a hint', () => {
  const html = renderSections(fixture, S({ sections: { runHistory: false, accessMap: false } }), ctx());
  assert.doesNotMatch(html, /data-section="runHistory"/);
  assert.doesNotMatch(html, /data-section="accessMap"/);
  const off = { activeTask: false, warnings: false, lastCompleted: false, runHistory: false, processCalendar: false, quickActions: false, deltaTracker: false, scriptHealth: false, accessMap: false };
  assert.match(renderSections(fixture, S({ sections: off }), ctx()), /Every section is switched off/);
});

test('user text is escaped, never injected', () => {
  const html = renderSections(fixture, S(), ctx());
  assert.doesNotMatch(html, /<b>bold\?<\/b>/);
  assert.match(html, /&lt;b&gt;bold\?&lt;\/b&gt;/);
  assert.match(html, /3,990 rows &amp; more/);
  assert.match(html, /Run &lt;it&gt;/);
});

test('active task: running shows step, elapsed, eta and warning count', () => {
  const html = renderSections(fixture, S({ sections: { warnings: false } }), ctx());
  assert.match(html, /Step 3\/7/);
  assert.match(html, /Looking up customers/);
  assert.match(html, /codicon-sync codicon-modifier-spin/);
  assert.match(html, /30s/);            // live elapsed at NOW
  assert.match(html, /~5s left/);       // live eta
  assert.match(html, /style="width:43%"/);
});

test('active task: stalled state and idle / missing folder hints', () => {
  const later = { now: new Date(NOW.getTime() + 45 * 60000), surface: 'panel', trusted: true };
  const html = renderSections(fixture, S(), later);
  assert.match(html, /task-stalled/);
  assert.match(html, /No update for 45 min/);
  const idle = renderSections({ ...fixture, progress: null }, S(), ctx());
  assert.match(idle, /No progress\.json yet/);
  const noDir = renderSections({ ...fixture, progress: null, logsDirExists: false }, S(), ctx());
  assert.match(noDir, /Logs folder not found/);
});

test('warnings section hides itself when there are none', () => {
  const data = { ...fixture, progress: { ...fixture.progress, warnings: [] } };
  assert.doesNotMatch(renderSections(data, S(), ctx()), /data-section="warnings"/);
  assert.match(renderSections(fixture, S(), ctx()), /Warnings \(1\)/);
});

test('last completed picks the newest run by date, not by array order', () => {
  const html = renderSections(fixture, S(), ctx());
  const card = html.slice(html.indexOf('data-section="lastCompleted"'), html.indexOf('data-section="quickActions"'));
  assert.match(card, /INSERT: 3,990 rows/);
  assert.match(card, /35s/);
  assert.match(card, /3[01]m ago/);   // 30.5 minutes, rounding is not the point
});

test('run history: newest first, capped by maxRows, sortable markers present', () => {
  const html = renderSections(fixture, S({ runHistoryMaxRows: 2 }), ctx());
  const card = html.slice(html.indexOf('data-section="runHistory"'), html.indexOf('data-section="scriptHealth"'));
  const tasks = [...card.matchAll(/class="col-task"[^>]*>([^<]+)</g)].map(m => m[1]);
  assert.deepEqual(tasks, ['Demo Pipeline', 'Demo Pipeline']);
  assert.match(card, /Showing 2 of 4 runs/);
  assert.match(card, /<th data-col="2"[^>]*class="sorted-desc"/);
  assert.match(card, /data-sort="1"/);
});

test('process calendar renders groups, marks and the overdue title', () => {
  const html = renderSections(fixture, S(), ctx());
  const card = html.slice(html.indexOf('data-section="processCalendar"'), html.indexOf('data-section="deltaTracker"'));
  assert.match(card, /Daily/);
  assert.match(card, /Monthly/);
  assert.match(card, /calendar-done/);
  assert.match(card, /calendar-pending/);
  assert.doesNotMatch(card, /overdue\)/);
  const late = { now: new Date(2026, 8, 20, 15, 0, 0), surface: 'panel', trusted: true };
  assert.match(renderSections(fixture, S(), late), /Process Calendar \(2 overdue\)/);
});

test('quick actions: grouped, indexed, prompt hint, disabled when untrusted', () => {
  const html = renderSections(fixture, S(), ctx());
  assert.match(html, /btn-group-label">Ops</);
  assert.match(html, /data-action="0"/);
  assert.match(html, /data-action="1"[^>]*>.*codicon-zap/s);   // no-confirm hint
  assert.doesNotMatch(html, /disabled/);
  const untrusted = renderSections(fixture, S(), ctx('panel', false));
  assert.match(untrusted, /data-action="0"[^>]*disabled/);
  assert.match(untrusted, /not trusted/);
});

test('delta tracker: every metric when list empty, only listed ones otherwise', () => {
  const all = renderSections(fixture, S(), ctx());
  assert.match(all, /rows_loaded/);
  assert.match(all, /reconciliation_delta/);
  assert.match(all, /trend-up/);
  assert.match(all, /<path class="sparkline" d="M /);
  const one = renderSections(fixture, S({ deltaMetrics: ['rows_loaded'] }), ctx());
  assert.doesNotMatch(one, /reconciliation_delta/);
  const missing = renderSections(fixture, S({ deltaMetrics: ['nope'] }), ctx());
  assert.match(missing, /no data yet/);
});

test('script health: one row per task with freshness', () => {
  const html = renderSections(fixture, S(), ctx());
  const card = html.slice(html.indexOf('data-section="scriptHealth"'), html.indexOf('data-section="accessMap"'));
  assert.equal((card.match(/<tr>/g) || []).length, 4); // header + 3 tasks
  assert.match(card, /Script Health \(2 stale\)/);
  assert.match(card, /fresh/);
});

test('access map: sidebar gets a summary + button, panel gets the canvas', () => {
  const side = renderSections(fixture, S(), ctx('sidebar'));
  assert.match(side, /data-open-panel="1"/);
  assert.doesNotMatch(side, /access-canvas/);
  const panel = renderSections(fixture, S(), ctx('panel'));
  assert.match(panel, /id="access-canvas"/);
  assert.match(panel, /id="map-legend"/);
  const none = renderSections({ ...fixture, access: null }, S(), ctx('panel'));
  assert.match(none, /No access\.json yet/);
});

test('read errors are surfaced', () => {
  const html = renderSections({ ...fixture, readErrors: ['progress.json: not valid JSON'] }, S(), ctx());
  assert.match(html, /read-errors/);
  assert.match(html, /progress\.json: not valid JSON/);
});
