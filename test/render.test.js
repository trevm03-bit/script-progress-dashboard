// Rendering tests: the HTML that reaches the webview, checked from fixture data.
const test = require('node:test');
const assert = require('node:assert/strict');

const { renderSections } = require('../out/render/dashboard.js');
const { esc, icon } = require('../out/render/html.js');
const fixture = require('./fixtures/data.json');
const { settings: S, ALL } = require('./fixtures/settings.js');

const NOW = new Date(2026, 8, 2, 10, 0, 30);
const ctx = (surface = 'panel', trusted = true, collapsed = []) => ({ now: NOW, surface, trusted, collapsed });
const order = html => [...html.matchAll(/data-section="([a-zA-Z]+)"/g)].map(m => m[1]);
const card = (html, id) => {
  const i = html.indexOf(`data-section="${id}"`);
  const start = html.lastIndexOf('<section', i);
  const j = html.indexOf('<section', i + 1);
  return html.slice(start === -1 ? i : start, j === -1 ? undefined : j);
};

test('esc and icon helpers', () => {
  assert.equal(esc(`<a href="x">Tom's & co</a>`), '&lt;a href=&quot;x&quot;&gt;Tom&#39;s &amp; co&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(icon('sync~spin'), '<i class="codicon codicon-sync codicon-modifier-spin"></i>');
  assert.equal(icon('bad name!'), '<i class="codicon codicon-badname"></i>');
  assert.equal(icon(''), '');
});

test('every enabled section appears once, in the default order', () => {
  assert.deepEqual(order(renderSections(fixture, S(), ctx())), ALL);
});

test('sectionOrder is honoured and unlisted sections go last', () => {
  const html = renderSections(fixture, S({ sectionOrder: ['runHistory', 'summary'] }), ctx());
  const o = order(html);
  assert.equal(o[0], 'runHistory');
  assert.equal(o[1], 'summary');
  assert.equal(o.length, ALL.length);
});

test('sidebarSections restricts the sidebar only', () => {
  const s = S({ sidebarSections: ['activeTask', 'runHistory'] });
  assert.deepEqual(order(renderSections(fixture, s, ctx('sidebar'))), ['activeTask', 'runHistory']);
  assert.deepEqual(order(renderSections(fixture, s, ctx('panel'))), ALL);
});

test('disabled sections are absent; all off shows a hint', () => {
  const html = renderSections(fixture, S({ sections: { runHistory: false, accessMap: false } }), ctx());
  assert.doesNotMatch(html, /data-section="runHistory"/);
  assert.doesNotMatch(html, /data-section="accessMap"/);
  const off = Object.fromEntries(ALL.map(id => [id, false]));
  assert.match(renderSections(fixture, S({ sections: off }), ctx()), /Every section is switched off/);
});

test('collapsed sections keep their title and hide the body; non-collapsible has no toggle', () => {
  const html = renderSections(fixture, S(), ctx('panel', true, ['runHistory']));
  const c = card(html, 'runHistory');
  assert.match(c, /class="card collapsed"/);
  assert.match(c, /<div class="section-body" hidden>/);
  assert.match(c, /codicon-chevron-right/);
  const fixed = renderSections(fixture, S({ dashboard: { collapsible: false } }), ctx());
  assert.doesNotMatch(card(fixed, 'runHistory'), /section-title toggle/);
});

test('user text is escaped, never injected', () => {
  const html = renderSections(fixture, S(), ctx());
  assert.doesNotMatch(html, /<b>bold\?<\/b>/);
  assert.match(html, /&lt;b&gt;bold\?&lt;\/b&gt;/);
  assert.match(html, /3,990 rows &amp; more/);
  assert.match(html, /Run &lt;it&gt;/);
});

test('summary strip: running, runs today, next due, stale', () => {
  const c = card(renderSections(fixture, S(), ctx()), 'summary');
  assert.match(c, /tile-running/);
  assert.match(c, /1<\/div><div class="tile-l">runs today/);
  assert.match(c, /next: Demo/);
  assert.match(c, /stale scripts/);
});

test('active task: running card shows substep, live elapsed, eta, log, metrics, artifacts', () => {
  const c = card(renderSections(fixture, S({ sections: { warnings: false } }), ctx()), 'activeTask');
  assert.match(c, /Step 3\/7/);
  assert.match(c, /\(50%\)/);
  assert.match(c, /codicon-sync codicon-modifier-spin/);
  assert.match(c, /30s/);
  assert.match(c, /~5s left/);
  assert.match(c, /style="width:36%"/);
  assert.match(c, /log-line/);
  assert.match(c, /joined 2,410 rows/);
  assert.match(c, /chip-k">rows_seen/);
  assert.match(c, /data-open="output\/partial.csv"/);
  assert.match(c, /20260902-100000-abc123/);
  const quiet = card(renderSections(fixture, S({ activeTask: { showLog: false, showMetrics: false, showArtifacts: false, logLines: 6 } }), ctx()), 'activeTask');
  assert.doesNotMatch(quiet, /log-line|chip-k|data-open/);
});

test('active task: multiple running tasks each get a card; stalled, exited and idle states', () => {
  const two = { ...fixture, tasks: [fixture.tasks[0], { ...fixture.tasks[0], task: 'Other Job', runId: 'x2' }] };
  const c = card(renderSections(two, S(), ctx()), 'activeTask');
  assert.match(c, /Active Tasks \(2\)/);
  assert.equal((c.match(/class="task-card/g) || []).length, 2);
  const later = { now: new Date(NOW.getTime() + 45 * 60000), surface: 'panel', trusted: true };
  assert.match(card(renderSections(fixture, S(), later), 'activeTask'), /No update for 45 min/);
  const exited = { ...fixture, overlays: [{ task: 'Demo Pipeline', exitCode: 2, when: '2026-09-02T10:00:25' }] };
  assert.match(card(renderSections(exited, S(), ctx()), 'activeTask'), /exited with code 2/);
  const idle = renderSections({ ...fixture, tasks: [], progress: null }, S(), ctx());
  assert.match(idle, /No progress\.json yet/);
  assert.match(idle, /data-msg="simulate"/);
  assert.match(renderSections({ ...fixture, tasks: [], progress: null, logsDirExists: false }, S(), ctx()), /Logs folder not found/);
});

test('warnings section hides itself when there are none', () => {
  const data = { ...fixture, tasks: [{ ...fixture.tasks[0], warnings: [] }] };
  assert.doesNotMatch(renderSections(data, S(), ctx()), /data-section="warnings"/);
  assert.match(renderSections(fixture, S(), ctx()), /Warnings \(1\)/);
});

test('last completed picks the newest run and shows its metrics and artifacts', () => {
  const c = card(renderSections(fixture, S(), ctx()), 'lastCompleted');
  assert.match(c, /INSERT: 3,990 rows/);
  assert.match(c, /35s/);
  assert.match(c, /3[01]m ago/);
  assert.match(c, /metric-user/);
  assert.match(c, /\$16.2M/);
  assert.match(c, /data-open="output\/load_report.xlsx"/);
});

test('run history: filters, detail rows, cap, sort markers, export link', () => {
  const html = renderSections(fixture, S({ runHistory: { maxRows: 2, filters: true, detail: true, trend: true } }), ctx());
  const c = card(html, 'runHistory');
  const tasks = [...c.matchAll(/class="col-task"[^>]*>(?:<i[^>]*><\/i>)?([^<]+)</g)].map(m => m[1]);
  assert.deepEqual(tasks, ['Demo Pipeline', 'Demo Pipeline']);
  assert.match(c, /Showing 2 of 4 runs/);
  assert.match(c, /<th data-col="2"[^>]*class="sorted-desc"/);
  assert.match(c, /class="filter-text"/);
  assert.match(c, /data-filter="fail">Failed <span class="n">1/);
  assert.match(c, /<tr class="detail" hidden>/);
  assert.match(c, /chip-table/);
  assert.match(c, /data-msg="exportCsv"/);
  const plain = card(renderSections(fixture, S({ runHistory: { maxRows: 15, filters: false, detail: false, trend: false } }), ctx()), 'runHistory');
  assert.doesNotMatch(plain, /filter-text|class="detail"/);
});

test('process calendar renders groups, marks, month grids, next due and the overdue aside', () => {
  const c = card(renderSections(fixture, S(), ctx()), 'processCalendar');
  assert.match(c, /Daily/);
  assert.match(c, /Monthly/);
  assert.match(c, /calendar-done/);
  assert.match(c, /calendar-pending/);
  assert.match(c, /month-grid/);
  assert.match(c, /class="day d-ok today"/);
  assert.match(c, /cal-next muted">due 5 Sep/);
  assert.match(c, /September 2026/);
  const late = { now: new Date(2026, 8, 20, 15, 0, 0), surface: 'panel', trusted: true };
  assert.match(card(renderSections(fixture, S(), late), 'processCalendar'), /3 overdue/);
  const list = card(renderSections(fixture, S({ calendar: { view: 'list', upcoming: false } }), ctx()), 'processCalendar');
  assert.doesNotMatch(list, /month-grid|cal-next/);
  assert.doesNotMatch(card(renderSections(fixture, S(), ctx('sidebar')), 'processCalendar'), /month-grid/); // 'both' collapses to list in the sidebar
});

test('quick actions: grouped, indexed, last-run status, disabled while its task runs or untrusted', () => {
  const html = renderSections(fixture, S(), ctx());
  const c = card(html, 'quickActions');
  assert.match(c, /btn-group-label">Ops</);
  assert.match(c, /data-action="0"[^>]*disabled/);           // task Demo Pipeline is running
  assert.match(c, /btn-status">.*running/);
  assert.match(c, /data-action="1"[^>]*>.*codicon-zap/s);     // no-confirm hint
  const idle = { ...fixture, tasks: [{ ...fixture.tasks[0], status: 'complete' }] };
  const c2 = card(renderSections(idle, S(), ctx()), 'quickActions');
  assert.doesNotMatch(c2, /data-action="0"[^>]*disabled/);
  assert.match(c2, /status-pass" title="Last run"/);
  const untrusted = card(renderSections(fixture, S(), ctx('panel', false)), 'quickActions');
  assert.match(untrusted, /data-action="1"[^>]*disabled/);
  assert.match(untrusted, /not trusted/);
  const noDisable = card(renderSections(fixture, S({ quickActions: { disableWhileRunning: false, runVia: 'task', asTasks: true, contextMenu: true, interpreters: {} } }), ctx()), 'quickActions');
  assert.doesNotMatch(noDisable, /data-action="0"[^>]*disabled/);
  assert.match(noDisable, /as tasks/);
});

test('delta tracker: metrics, formats, thresholds, points cap', () => {
  const all = card(renderSections(fixture, S(), ctx()), 'deltaTracker');
  assert.match(all, /rows_loaded/);
  assert.match(all, /reconciliation_delta/);
  assert.match(all, /trend-up/);
  assert.match(all, /<path class="sparkline" d="M /);
  assert.match(all, /sparkline-area/);
  const one = card(renderSections(fixture, S({ deltaMetrics: ['rows_loaded'] }), ctx()), 'deltaTracker');
  assert.doesNotMatch(one, /reconciliation_delta/);
  const fmt = card(renderSections(fixture, S({ deltas: { formats: { rows_loaded: { unit: 'rows', label: 'Rows loaded' } }, thresholds: { rows_loaded: { max: 4000 } }, points: 50 } }), ctx()), 'deltaTracker');
  assert.match(fmt, /Rows loaded/);
  assert.match(fmt, /4,001 rows/);
  assert.match(fmt, /delta-bad/);
  assert.match(fmt, /1 out of range/);
  assert.match(fmt, /class="guide"/);
  const two = card(renderSections(fixture, S({ deltas: { formats: {}, thresholds: {}, points: 2 } }), ctx()), 'deltaTracker');
  assert.match(two, /2 pts/);
  assert.match(card(renderSections(fixture, S({ deltaMetrics: ['nope'] }), ctx()), 'deltaTracker'), /no data yet/);
});

test('script health: one row per task with dots, fail %, trend and freshness', () => {
  const c = card(renderSections(fixture, S(), ctx()), 'scriptHealth');
  assert.equal((c.match(/<tr>/g) || []).length, 4); // header + 3 tasks
  assert.match(c, /2 stale/);
  assert.match(c, /dot dot-ok/);
  assert.match(c, /dot dot-fail/);
  assert.match(c, /100%/);
  assert.match(c, /trend-svg/);
  const noDots = card(renderSections(fixture, S({ health: { resultDots: 0 }, runHistory: { maxRows: 15, filters: true, detail: true, trend: false } }), ctx()), 'scriptHealth');
  assert.doesNotMatch(noDots, /class="dots"|trend-svg/);
});

test('access map: sidebar gets summary + mini preview + button, panel gets toolbar + canvas', () => {
  const side = card(renderSections(fixture, S(), ctx('sidebar')), 'accessMap');
  assert.match(side, /data-msg="openMap"/);
  assert.match(side, /map-host-mini/);
  assert.doesNotMatch(side, /map-toolbar/);
  const noMini = card(renderSections(fixture, S({ accessMap: { sidebarPreview: false, maxNodes: 150, layout: 'force', timeWindowDays: 0, labels: 'auto', replay: true } }), ctx('sidebar')), 'accessMap');
  assert.doesNotMatch(noMini, /map-host-mini/);
  const panel = card(renderSections(fixture, S(), ctx('panel')), 'accessMap');
  assert.match(panel, /class="map-canvas"/);
  assert.match(panel, /class="map-search"/);
  assert.match(panel, /class="map-detail"/);
  assert.match(panel, /status-run/); // live badge
  assert.match(card(renderSections({ ...fixture, access: null }, S(), ctx('panel')), 'accessMap'), /No access\.json yet/);
});

test('read errors are surfaced', () => {
  const html = renderSections({ ...fixture, readErrors: ['progress.json: not valid JSON'] }, S(), ctx());
  assert.match(html, /read-errors/);
  assert.match(html, /progress\.json: not valid JSON/);
});

// ---------------------------------------------------------------- first run
test('a brand-new install shows one welcome panel, not a stack of empty cards', () => {
  const blank = { progress: null, tasks: [], history: [], deltas: {}, impact: {}, access: null,
    overlays: [], logsDir: 'C:/proj/logs', logsDirExists: false, readErrors: [] };
  const html = renderSections(blank, S(), ctx());
  assert.equal([...html.matchAll(/data-section=/g)].length, 0, 'no section cards before anything has reported');
  assert.match(html, /No script has reported yet/);
  // It must offer a way forward, not just state the problem.
  for (const msg of ['simulate', 'walkthrough', 'layout']) {
    assert.match(html, new RegExp(`data-msg="${msg}"`), `offers ${msg}`);
  }
});

test('the welcome panel yields as soon as anything has reported', () => {
  const oneRun = { progress: null, tasks: [], history: [{ task: 'T', date: new Date().toISOString(), success: true, elapsed: 5, summary: 'ok', warnings: 0 }],
    deltas: {}, impact: {}, access: null, overlays: [], logsDir: 'C:/proj/logs', logsDirExists: true, readErrors: [] };
  const html = renderSections(oneRun, S(), ctx());
  assert.ok([...html.matchAll(/data-section=/g)].length > 0, 'the real dashboard comes back');
  assert.doesNotMatch(html, /No script has reported yet/);
});

test('a read error is shown rather than hidden behind the welcome panel', () => {
  const broken = { progress: null, tasks: [], history: [], deltas: {}, impact: {}, access: null,
    overlays: [], logsDir: 'C:/proj/logs', logsDirExists: true, readErrors: ['run_history.json: broken'] };
  assert.match(renderSections(broken, S(), ctx()), /broken/);
});
