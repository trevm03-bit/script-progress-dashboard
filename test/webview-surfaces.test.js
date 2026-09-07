// The last two files nothing had ever loaded: the sidebar view and the editor-tab panels.
//
// Both are thin — 3 KB and 2 KB — and "thin" is why they were skipped. But thin does not mean
// trivial: between them they own the Activity Bar badge, the panel registry that decides whether
// a second Ctrl+Shift+P opens a duplicate tab, and the re-resolve path that was leaking two
// listeners per hide/show cycle until someone noticed by hand. None of that had a test.
//
// The value here is regression fencing rather than discovery: these are the behaviours that were
// fixed once already and have nothing stopping them coming back.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const { install, calls } = require('./fixtures/vscode-stub.js');
const vscode = install();

const { DashboardViewProvider } = require(path.join(repo, 'out/dashboardView.js'));
const { DashboardPanel } = require(path.join(repo, 'out/dashboardPanel.js'));
const { settings: S } = require('./fixtures/settings.js');

// 🔴 The provider reads `new Date()` itself — there is no clock to inject — so every fixture time
// has to be anchored to the REAL wall clock, and written in LOCAL time because that is how a naked
// ISO string parses. A first draft anchored to a fabricated "now" and formatted through
// toISOString(), which quietly shifted every timestamp by the UTC offset and made three live
// scripts read as stalled. The tests failed, which is the only reason it was caught.
const NOW = new Date();
const iso = (d) => {
  const t = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}` +
    `T${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
};
const minutesAgo = (m) => iso(NOW.getTime() - m * 60000);
/** Local noon on the calendar day `offset` days from today — never near a midnight boundary. */
const dayAtNoon = (offset) => {
  const d = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + offset, 12, 0, 0);
  return iso(d);
};

const base = {
  progress: null, tasks: [], history: [], deltas: {}, impact: {}, access: null,
  overlays: [], logsDir: 'C:/ws/logs', logsDirExists: true, readErrors: [],
};

/** A ProgressData good enough for taskState: a status and a write time. */
const task = (over = {}) => ({
  task: 'Nightly', status: 'running', step: 1, totalSteps: 3, label: '', detail: '',
  elapsed: 10, eta: null, warnings: [], updatedAt: minutesAgo(1), ...over,
});
const run = (over = {}) => ({
  task: 'Nightly', date: iso(NOW), success: true, elapsed: 30, warnings: 0, summary: 'ok', ...over,
});

function makeState(over = {}) {
  return {
    data: { ...base, ...(over.data || {}) },
    settings: over.settings || S(),
    collapsedIds: [],
    getData() { return this.data; },
    getSettings() { return this.settings; },
    runner: { runButton: async () => {} },
    getCollapsed() { return this.collapsedIds; },
    setCollapsed(ids) { this.collapsedIds = ids; },
  };
}

/**
 * The sidebar provider, resolved onto a fresh WebviewView.
 *
 * `now` is baked in through the data rather than through a clock the provider takes, because the
 * provider reads `new Date()` itself — so every fixture is expressed relative to NOW and the tests
 * stay honest about only asserting what a real wall clock would also produce.
 */
function makeView(over = {}) {
  vscode.__reset();
  const state = makeState(over);
  const provider = new DashboardViewProvider(vscode.Uri.file('C:/ext'), state);
  const view = vscode.makeWebviewView();
  provider.resolveWebviewView(view);
  return { provider, view, state };
}

// ================================================================ the sidebar view

test('resolving the view renders a page and listens to it', () => {
  const { view } = makeView();
  assert.match(view.webview.html, /<!DOCTYPE html>/i);
  assert.equal(view.webview.__listenerCount(), 1, 'the host must be listening for page messages');
  assert.equal(view.__listenerCount(), 2, 'one visibility listener and one dispose listener');
});

test('re-resolving the same view does not stack listeners', () => {
  // 🔴 The regression this file exists to fence. A hidden sidebar view is destroyed and
  // resolveWebviewView is called AGAIN on the same WebviewView object. Before the fix each pass
  // added a visibility listener and a dispose listener without removing the previous pair, and
  // every leaked visibility listener drove another full re-render on the next show — so the cost
  // grew with how often the user collapsed the sidebar, which is the least suspicious action there
  // is. Nothing about the page looked wrong, which is why it survived so long.
  const { provider, view } = makeView();
  provider.resolveWebviewView(view);
  provider.resolveWebviewView(view);
  assert.equal(view.__listenerCount(), 2, 'still exactly one visibility + one dispose listener');
  assert.equal(view.webview.__listenerCount(), 1, 'and exactly one message listener');
});

test('re-resolving does not make one click run twice', async () => {
  // The user-visible cost of the leak, which counting listeners does not show: a second live host
  // still listening to the same webview handles the same click a second time. Collapse the sidebar
  // once and every button afterwards fires twice — including "Run" buttons that start real scripts.
  const { provider, view } = makeView();
  provider.resolveWebviewView(view);
  provider.resolveWebviewView(view);
  calls.commands.length = 0;
  await view.webview.__send({ type: 'refresh' });
  const refreshes = calls.commands.filter(c => c.id === 'scriptProgress.refresh');
  assert.equal(refreshes.length, 1, `one click must run one command, ran ${refreshes.length}`);
});

test('becoming visible re-renders, and going hidden does not', () => {
  const { view } = makeView({ data: { tasks: [task()] } });
  calls.posted.length = 0;
  view.__setVisible(false);
  assert.equal(calls.posted.length, 0, 'a hidden view has nothing to update');
  view.__setVisible(true);
  assert.ok(calls.posted.length >= 1, 'coming back must repaint — the page was destroyed while hidden');
});

test('a disposed view is safe to refresh', () => {
  const { provider, view } = makeView({ data: { tasks: [task()] } });
  view.__dispose();
  assert.doesNotThrow(() => provider.refresh(true));
  calls.posted.length = 0;
  provider.refresh(true);
  assert.equal(calls.posted.length, 0, 'nothing should be posted to a webview that is gone');
});

test('refreshing before the view is ever resolved is safe', () => {
  vscode.__reset();
  const provider = new DashboardViewProvider(vscode.Uri.file('C:/ext'), makeState());
  assert.doesNotThrow(() => provider.refresh(true), 'the poll timer runs before the sidebar is opened');
});

// ---------------------------------------------------------------- the badge

test('the running badge counts running scripts, and disappears at zero', () => {
  const none = makeView({ settings: S({ badge: 'running' }), data: { tasks: [] } });
  assert.equal(none.view.badge, undefined, 'a badge of 0 renders as a visible dot in the Activity Bar');

  const one = makeView({ settings: S({ badge: 'running' }), data: { tasks: [task()] } });
  assert.equal(one.view.badge.value, 1);
  assert.equal(one.view.badge.tooltip, '1 script running');

  const two = makeView({
    settings: S({ badge: 'running' }),
    data: { tasks: [task(), task({ task: 'Other' })] },
  });
  assert.equal(two.view.badge.value, 2);
  assert.equal(two.view.badge.tooltip, '2 scripts running', 'plural');
});

test('the running badge does not count finished or stalled scripts', () => {
  const { view } = makeView({
    settings: S({ badge: 'running', staleRunningMinutes: 30 }),
    data: {
      tasks: [
        task({ status: 'complete' }),
        task({ status: 'failed' }),
        task({ status: 'running', updatedAt: minutesAgo(90) }), // stalled: nothing is running here
        task({ status: 'running', updatedAt: minutesAgo(2) }),  // the only live one
      ],
    },
  });
  assert.equal(view.badge.value, 1, 'a script that died 90 minutes ago is not "running"');
});

test('the failures badge counts today only', () => {
  const { view } = makeView({
    settings: S({ badge: 'failures' }),
    data: {
      history: [
        run({ success: false, date: dayAtNoon(0) }),   // today
        run({ success: false, date: dayAtNoon(0) }),   // today, another one
        run({ success: false, date: dayAtNoon(-1) }),  // yesterday
        run({ success: true, date: dayAtNoon(0) }),    // today, fine
      ],
    },
  });
  assert.equal(view.badge.value, 2, 'yesterday\'s failures are not today\'s problem');
  assert.equal(view.badge.tooltip, '2 failed runs today');
});

test('the failures badge ignores an unparseable date rather than counting it', () => {
  const { view } = makeView({
    settings: S({ badge: 'failures' }),
    data: { history: [run({ success: false, date: 'not a date' })] },
  });
  assert.equal(view.badge, undefined, 'a corrupt row must not invent a failure');
});

test('badge: off shows nothing even with work in flight', () => {
  const { view } = makeView({
    settings: S({ badge: 'off' }),
    data: { tasks: [task()], history: [run({ success: false })] },
  });
  assert.equal(view.badge, undefined);
});

test('the badge updates on refresh, not only on resolve', () => {
  const { provider, view, state } = makeView({ settings: S({ badge: 'running' }), data: { tasks: [] } });
  assert.equal(view.badge, undefined);
  state.data = { ...base, tasks: [task()] };
  provider.refresh();
  assert.equal(view.badge && view.badge.value, 1, 'the badge is stale until refresh recomputes it');
});

// ================================================================ the editor-tab panels

/** Close everything the panel registry is holding, so each test starts from empty. */
function closeAllPanels() {
  for (const p of vscode.__panels.slice()) p.dispose();
  vscode.__reset();
}

test('opening the dashboard creates one locked-down panel', () => {
  closeAllPanels();
  DashboardPanel.createOrShow(vscode.Uri.file('C:/ext'), makeState(), 'panel');
  assert.equal(vscode.__panels.length, 1);
  const p = vscode.__panels[0];
  assert.equal(p.viewType, 'scriptProgress.panel');
  assert.equal(p.title, 'Script Progress Dashboard');
  assert.equal(p.options.enableScripts, true);
  assert.equal(p.options.retainContextWhenHidden, true, 'the map layout must survive a tab switch');
  // The page may only load from media/. Rooting it at the extension folder would expose src/,
  // out/ and anything else that ships inside the .vsix to a page that renders untrusted text.
  const roots = p.options.localResourceRoots.map(u => String(u.fsPath));
  assert.equal(roots.length, 1);
  assert.match(roots[0], /[\\/]media$/);
  assert.match(String(p.iconPath.fsPath), /media[\\/]icon\.svg$/);
  closeAllPanels();
});

test('opening it again reveals the same tab instead of a second one', () => {
  closeAllPanels();
  const uri = vscode.Uri.file('C:/ext');
  const state = makeState();
  const first = DashboardPanel.createOrShow(uri, state, 'panel');
  const second = DashboardPanel.createOrShow(uri, state, 'panel');
  assert.equal(second, first, 'the command is a singleton per surface');
  assert.equal(vscode.__panels.length, 1, 'a duplicate tab is the bug this registry prevents');
  assert.equal(vscode.__panels[0].__reveals.length, 1);
  assert.equal(vscode.__panels[0].__reveals[0].preserveFocus, true, 'revealing must not steal the cursor');
  closeAllPanels();
});

test('the dashboard and the map are separate tabs', () => {
  closeAllPanels();
  const uri = vscode.Uri.file('C:/ext');
  const state = makeState();
  const dash = DashboardPanel.createOrShow(uri, state, 'panel');
  const map = DashboardPanel.createOrShow(uri, state, 'map');
  assert.notEqual(map, dash);
  assert.equal(vscode.__panels.length, 2);
  assert.equal(vscode.__panels[1].viewType, 'scriptProgress.map');
  assert.equal(vscode.__panels[1].title, 'Access Map');
  assert.equal(DashboardPanel.current, dash);
  assert.equal(DashboardPanel.map, map);
  closeAllPanels();
});

test('closing a tab lets the next command open a fresh one', () => {
  closeAllPanels();
  const uri = vscode.Uri.file('C:/ext');
  const state = makeState();
  const first = DashboardPanel.createOrShow(uri, state, 'panel');
  vscode.__panels[0].dispose();
  assert.equal(DashboardPanel.current, undefined, 'a closed tab must leave the registry');
  const second = DashboardPanel.createOrShow(uri, state, 'panel');
  assert.notEqual(second, first, 'reusing a disposed panel would post to a dead webview');
  assert.equal(vscode.__panels.length, 2);
  closeAllPanels();
});

test('refreshAll updates every open tab', () => {
  closeAllPanels();
  const uri = vscode.Uri.file('C:/ext');
  const state = makeState({ data: { tasks: [task()] } });
  DashboardPanel.createOrShow(uri, state, 'panel');
  DashboardPanel.createOrShow(uri, state, 'map');
  calls.posted.length = 0;
  DashboardPanel.refreshAll(true);
  assert.equal(calls.posted.length, 2, 'both the dashboard and the map must repaint');
  closeAllPanels();
});

test('refreshAll with nothing open is a no-op, not a crash', () => {
  closeAllPanels();
  assert.doesNotThrow(() => DashboardPanel.refreshAll(true), 'the poll timer calls this every tick');
  assert.equal(calls.posted.length, 0);
});
