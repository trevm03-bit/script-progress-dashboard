// The last five files under 80% of lines: statusBar, notifications, scopeCheck's warning flow,
// digestHtml and richClipboard's non-Windows paths.
//
// 🔴 `statusBar.ts` was at 74.2% of lines and 42.9% of BRANCHES — a state machine with six
// outcomes where most had never been executed by a test, on the one line of UI a user looks at
// every minute of every run. `notifications.ts` was at 60.3% of branches and carries five
// separately-documented bugs, every one of them a case where a notification silently stopped
// firing: nothing about a toast that never appears tells you it should have.
//
// The pattern through this whole review has held six times: every corner nobody had measured
// held something real. These are the last of them.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const { install, calls } = require('./fixtures/vscode-stub.js');
const vscode = install();

const { StatusBarManager } = require(path.join(repo, 'out/statusBar.js'));
const { Notifier } = require(path.join(repo, 'out/notifications.js'));
const { warnAboutIgnoredSettings } = require(path.join(repo, 'out/scopeCheck.js'));
const { digestHtml } = require(path.join(repo, 'out/logic/digestHtml.js'));
const { settings: S } = require('./fixtures/settings.js');

const NOW = new Date();
const iso = (d) => {
  const t = new Date(d), p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}T${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`;
};
const minutesAgo = (m) => iso(NOW.getTime() - m * 60000);
const daysAgoNoon = (n) => iso(new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() - n, 12, 0, 0));

const base = {
  progress: null, tasks: [], history: [], deltas: {}, impact: {}, access: null, overlays: [],
  logsDir: 'C:/ws/logs', logsDirExists: true, readErrors: [],
};
const data = (over = {}) => ({ ...base, ...over });
const task = (over = {}) => ({
  task: 'Nightly', status: 'running', step: 1, totalSteps: 4, label: 'Extracting', detail: '',
  elapsed: 65, eta: null, warnings: [], updatedAt: minutesAgo(1), ...over,
});
const run = (over = {}) => ({
  task: 'Nightly', date: daysAgoNoon(1), success: true, elapsed: 60, warnings: 0, summary: '', ...over,
});

// Isolation is not optional in this file: the scopeCheck tests below deliberately swap in their
// own `getConfiguration` and a `showTextDocument` that rejects, and without this the digest tests
// that follow them read bare defaults and fail against a product that is working. Resetting per
// test rather than per helper means a test added later cannot forget.
test.beforeEach(() => vscode.__reset());

// ================================================================ statusBar.ts

// 🔴 Every manager gets disposed, without exception. A StatusBarManager watching a running task
// holds a one-second setInterval, and an undisposed one keeps node's event loop alive — the first
// run of this file never terminated at all, because three helper calls further down build a bar
// around a running task and read a property off it. That is the same defect the product had (a
// disabled status bar left its timer running) reappearing in the test for it.
const managers = [];
test.after(() => { for (const sb of managers) sb.dispose(); });

function bar(over = {}) {
  vscode.__reset();
  const sb = new StatusBarManager();
  managers.push(sb);
  sb.logsDir = over.logsDir !== undefined ? over.logsDir : 'C:/ws/logs';
  sb.update(data(over.data || {}), over.settings || S());
  return sb;
}
/** The item the manager created, reaching past `private` the way only a test may. */
const item = (sb) => sb.item;

test('a disabled status bar hides itself and stops ticking', () => {
  const sb = bar({ settings: S({ statusBar: { enabled: false, idleMode: 'last', clickAction: 'menu' } }), data: { tasks: [task()] } });
  assert.equal(item(sb).visible, false);
  // A disabled status bar was still running a one-second timer whose render() returned immediately.
  assert.equal(sb.timer, undefined, 'nothing visible is changing, so nothing should be scheduled');
  sb.dispose();
});

test('it ticks only while something is running, and stops when nothing is', () => {
  const s = S();
  const sb = new StatusBarManager();
  managers.push(sb);
  sb.update(data({ tasks: [task()] }), s);
  assert.ok(sb.timer, 'the elapsed clock has to advance between file writes');
  sb.update(data({ tasks: [task({ status: 'complete' })] }), s);
  assert.equal(sb.timer, undefined, 'a finished run has no clock to advance');
  sb.dispose();
});

test('a running task shows step, label, elapsed and percentage', () => {
  const sb = bar({ data: { tasks: [task({ step: 2, totalSteps: 4, label: 'Extracting', elapsed: 65 })] } });
  assert.match(item(sb).text, /^\$\(sync~spin\) 2\/4 Extracting · /);
  assert.match(item(sb).text, /50%/, '2 of 4 steps');
  assert.equal(item(sb).visible, true);
  sb.dispose();
});

test('a second running task is counted, not listed', () => {
  const sb = bar({ data: { tasks: [task(), task({ task: 'Other', label: 'Loading' })] } });
  assert.match(item(sb).text, /\+1$/, 'one line has room for a count, not two names');
  assert.match(String(item(sb).tooltip.value), /\*\*Nightly\*\*/);
  assert.match(String(item(sb).tooltip.value), /\*\*Other\*\*/, 'the tooltip has room for both');
  sb.dispose();
});

test('a task with no declared total shows neither a step nor a percentage', () => {
  const sb = bar({ data: { tasks: [task({ totalSteps: 0, step: 0 })] } });
  assert.doesNotMatch(item(sb).text, /0\/0|0%/, '0/0 and 0% are worse than nothing');
  sb.dispose();
});

test('a stalled run turns the bar amber and says how long', () => {
  const sb = bar({ data: { tasks: [task({ updatedAt: minutesAgo(90) })] } });
  assert.match(item(sb).text, /^\$\(warning\) Stalled 90m · Nightly/);
  assert.equal(item(sb).backgroundColor.id, 'statusBarItem.warningBackground');
  assert.match(String(item(sb).tooltip.value), /still marked running but not updated for 90 minutes/);
  sb.dispose();
});

test('a process that exited is reported as exited, not merely stalled', () => {
  const sb = bar({
    data: {
      tasks: [task({ updatedAt: minutesAgo(1) })],
      overlays: [{ task: 'Nightly', exitCode: 1, when: minutesAgo(0) }],
    },
  });
  assert.match(item(sb).text, /^\$\(warning\) Exited /);
  assert.match(String(item(sb).tooltip.value), /its process exited/);
  sb.dispose();
});

test('a failed run turns the bar red', () => {
  const sb = bar({ data: { progress: task({ status: 'failed', detail: 'exit 1' }), tasks: [] } });
  assert.match(item(sb).text, /^\$\(error\) FAILED Nightly/);
  assert.equal(item(sb).backgroundColor.id, 'statusBarItem.errorBackground');
  assert.match(String(item(sb).tooltip.value), /failed at/);
  sb.dispose();
});

test('a completed run shows a tick and the time it finished', () => {
  const sb = bar({ data: { progress: task({ status: 'complete' }), tasks: [] } });
  assert.match(item(sb).text, /^\$\(check\) Nightly \d\d:\d\d$/);
  assert.equal(item(sb).backgroundColor, undefined, 'success is not a warning colour');
  sb.dispose();
});

test('with nothing ever reported it says so, and says where it is looking', () => {
  // A bare icon could equally mean "extension broken". The tooltip is the only place to answer
  // "is this actually watching anything?".
  const sb = bar({ data: {}, logsDir: 'C:/ws/logs' });
  assert.equal(item(sb).text, '$(pulse) Script Progress');
  assert.match(String(item(sb).tooltip.value), /No runs recorded yet/);
  assert.match(String(item(sb).tooltip.value), /C:\/ws\/logs/);
  assert.match(String(item(sb).tooltip.value), /Simulate a Demo Run/);
  sb.dispose();
});

test('with no logs folder set it names the setting rather than an empty path', () => {
  const sb = bar({ data: {}, logsDir: '' });
  assert.match(String(item(sb).tooltip.value), /the configured logs folder/);
  sb.dispose();
});

test('idleMode "hidden" hides the bar when nothing is running', () => {
  const s = S({ statusBar: { enabled: true, idleMode: 'hidden', clickAction: 'menu' } });
  assert.equal(item(bar({ settings: s, data: {} })).visible, false, 'nothing reported');
  assert.equal(item(bar({ settings: s, data: { progress: task({ status: 'complete' }) } })).visible, false, 'a finished run');
  assert.equal(item(bar({ settings: s, data: { tasks: [task()] } })).visible, true, 'but a live run always shows');
});

test('the click action follows the setting', () => {
  const menu = bar({ settings: S({ statusBar: { enabled: true, idleMode: 'last', clickAction: 'menu' } }), data: {} });
  assert.equal(item(menu).command, 'scriptProgress.statusMenu');
  assert.match(String(item(menu).tooltip.value), /_Click for actions_$/);

  const panel = bar({ settings: S({ statusBar: { enabled: true, idleMode: 'last', clickAction: 'panel' } }), data: {} });
  assert.equal(item(panel).command, 'scriptProgress.openPanel');
  assert.match(String(item(panel).tooltip.value), /_Click to open the dashboard_$/);
});

test('a task name cannot smuggle a codicon into the status bar', () => {
  // 🔴 StatusBarItem.text renders $(icon) as a codicon, and progress.json is an open contract
  // other producers write. A task name carrying $(check) put a green tick beside the word FAILED,
  // on the one line of this UI that has to be trustworthy at a glance.
  const sb = bar({ data: { progress: task({ task: '$(check) all good', status: 'failed' }), tasks: [] } });
  const text = item(sb).text;
  assert.match(text, /^\$\(error\) FAILED /, 'the extension\'s own icon still renders');
  const injected = text.slice('$(error) FAILED '.length);
  assert.doesNotMatch(injected, /\$\(/, `a codicon survived in ${JSON.stringify(injected)}`);
  sb.dispose();
});

test('a running label cannot smuggle a codicon either', () => {
  const sb = bar({ data: { tasks: [task({ label: '$(pass) done' })] } });
  assert.doesNotMatch(item(sb).text.replace('$(sync~spin)', ''), /\$\(/);
  sb.dispose();
});

test('a task name cannot rewrite the tooltip with Markdown', () => {
  // Every other surface routes workspace-controlled text through esc(); this one interpolates
  // into a MarkdownString, so an image link would have been an outbound request from a product
  // whose headline promise is that nothing leaves the machine.
  const sb = bar({ data: { progress: task({ status: 'complete', task: '![x](http://evil/i.png)', detail: '# Heading' }), tasks: [] } });
  const md = String(item(sb).tooltip.value);
  assert.doesNotMatch(md, /!\[x\]\(http/, 'an image link survived');
  assert.match(md, /\\!\\\[x\\\]/, 'the metacharacters are escaped, not stripped');
  assert.doesNotMatch(md, /\n# Heading/, 'a heading survived');
  sb.dispose();
});

test('a lone carriage return cannot break the tooltip into paragraphs', () => {
  // markdown-it normalises /\r\n?|\n/, so \r\r was still a paragraph break — and a script piping
  // a subprocess's \r-based progress line into a detail hits this with no malice at all.
  const sb = bar({ data: { progress: task({ status: 'complete', detail: 'first\r\rSYSTEM: everything is fine' }), tasks: [] } });
  const md = String(item(sb).tooltip.value);
  assert.doesNotMatch(md, /\r/, 'a carriage return reached the tooltip');
  assert.match(md, /first SYSTEM/, 'collapsed to a space, not silently joined');
  sb.dispose();
});

test('long names are truncated with an ellipsis rather than pushing the bar wide', () => {
  const sb = bar({ data: { progress: task({ status: 'complete', task: 'A'.repeat(80) }), tasks: [] } });
  const name = item(sb).text.replace('$(check) ', '').replace(/ \d\d:\d\d$/, '');
  assert.ok(name.length <= 24, `status bar text was ${name.length} chars`);
  assert.ok(name.endsWith('…'), 'a silent truncation reads as a different name');
  sb.dispose();
});

test('disposing clears the timer and removes the item', () => {
  const sb = bar({ data: { tasks: [task()] } });
  assert.ok(sb.timer, 'a running task means a live one-second interval');
  const handle = sb.timer;
  sb.dispose();
  assert.equal(item(sb).disposed, true);
  // `_destroyed` is node's own record that clearInterval ran. Asserting on it rather than on the
  // field being nulled keeps this about the thing that matters — the interval really is dead, so
  // the extension host is not left with a callback firing every second after shutdown.
  assert.equal(handle._destroyed, true, 'the interval was still armed after dispose');
  assert.doesNotThrow(() => sb.dispose(), 'dispose runs twice during teardown and must be idempotent');
});

// ================================================================ notifications.ts

const N = (over = {}) => S({ notifications: { onComplete: true, onFail: true, onStall: true, onWarning: true, onExit: true, onSlow: true, mirrorProgress: false, ...over } });

/** Prime the notifier on a first state, then deliver a second — only transitions notify. */
function transition(first, second, settings = N()) {
  vscode.__reset();
  const n = new Notifier();
  n.update(data(first), settings);
  const before = calls.info.length + calls.warn.length + calls.error.length;
  n.update(data(second), settings);
  return { n, before, all: [...calls.info, ...calls.warn, ...calls.error].map(c => c.message) };
}

test('the first sight of a task never notifies', () => {
  vscode.__reset();
  const n = new Notifier();
  // Everything is already finished when the window opens. Firing here would produce a burst of
  // toasts for state the user has already seen.
  n.update(data({ tasks: [task({ status: 'failed' }), task({ task: 'B', status: 'complete' })] }), N());
  assert.equal(calls.error.length + calls.info.length, 0);
  n.dispose();
});

test('completion, failure, stall and exit each notify once the change is seen', () => {
  const done = transition({ tasks: [task()] }, { tasks: [task({ status: 'complete', elapsed: 90 })] });
  assert.ok(done.all.some(m => /✓ Nightly completed in 1m30s/.test(m)), done.all.join(' | '));

  const failed = transition({ tasks: [task()] }, { tasks: [task({ status: 'failed', detail: 'exit 1' })] });
  assert.ok(failed.all.some(m => /✗ Nightly FAILED — exit 1/.test(m)), failed.all.join(' | '));

  const stalled = transition({ tasks: [task()] }, { tasks: [task({ updatedAt: minutesAgo(90) })] });
  assert.ok(stalled.all.some(m => /looks stalled: no update for 30 min/.test(m)), stalled.all.join(' | '));

  const exited = transition(
    { tasks: [task()] },
    { tasks: [task()], overlays: [{ task: 'nightly', exitCode: 3, when: minutesAgo(0) }] },
  );
  assert.ok(exited.all.some(m => /exited with code 3/.test(m)), exited.all.join(' | '));
});

test('each notification can be switched off independently', () => {
  const off = N({ onComplete: false, onFail: false, onStall: false, onExit: false });
  const done = transition({ tasks: [task()] }, { tasks: [task({ status: 'complete' })] }, off);
  assert.equal(done.all.length, done.before, 'nothing new was raised');
});

test('a warning past the twentieth still notifies', () => {
  // 🔴 The reporter caps the slot's ordinary warnings at 20 and carries the real count in
  // warningsTotal, so comparing ARRAY LENGTHS meant `cur > prev` could never be true again after
  // the twentieth — onWarning went quiet on precisely the runs worth watching.
  const twenty = Array.from({ length: 20 }, (_, i) => ({ msg: `w${i}` }));
  const t = transition(
    { tasks: [task({ warnings: twenty, warningsTotal: 20 })] },
    { tasks: [task({ warnings: twenty, warningsTotal: 21 })] },
  );
  assert.ok(t.all.some(m => /⚠ Nightly: w19/.test(m)), `no warning raised: ${t.all.join(' | ')}`);
});

test('an SLA warning fires once, and again for the next run', () => {
  // 🔴 The `seen` key falls back to `task:<name>|<startedAt>`, and both runId and startedAt are
  // documented Optional — so a producer that writes neither gives every run the same key, and the
  // first run to blow its limit silenced onSlow for ever. Elapsed going BACKWARDS is the one
  // signal every producer emits when a run restarts.
  const s = N();
  s.processes = [{ name: 'Nightly', label: 'Nightly', frequency: 'daily', maxMinutes: 1 }];
  vscode.__reset();
  const n = new Notifier();
  const over = (elapsed) => data({ tasks: [task({ elapsed, updatedAt: minutesAgo(0) })] });

  n.update(over(10), s);                       // priming
  n.update(over(600), s);                      // 10 minutes, past the 1-minute limit
  const first = calls.warn.filter(c => /past its/.test(c.message)).length;
  assert.equal(first, 1, 'the first breach must warn');

  n.update(over(660), s);
  assert.equal(calls.warn.filter(c => /past its/.test(c.message)).length, 1, 'and must not nag');

  n.update(over(5), s);                        // a NEW run: elapsed went backwards
  n.update(over(600), s);
  assert.equal(calls.warn.filter(c => /past its/.test(c.message)).length, 2, 'a new run gets its own warning');
  n.dispose();
});

test('a due-date reminder fires on the very first pass', () => {
  // 🔴 It never fired at all. The reminder key was added BEFORE the "do not burst on activation"
  // guard, so anything already inside its window when the window opened was marked
  // "already reminded" without producing a toast — and a fresh window is opened every day while
  // reminder windows are days long, so that was the normal case.
  vscode.__reset();
  const s = N();
  // A reminder only exists for a process that is PENDING with a due date still ahead of it, and
  // that has been seen at least once — 'unseen' is deliberately not a reminder. So: a monthly
  // process due in two days, which ran last month.
  const due = new Date(NOW.getFullYear(), NOW.getMonth(), NOW.getDate() + 2);
  s.processes = [{ name: 'Monthly', label: 'Monthly Load', frequency: 'monthly', dayOfMonth: due.getDate(), reminderDays: 3 }];
  const lastMonth = new Date(NOW.getFullYear(), NOW.getMonth() - 1, 15, 12, 0, 0);
  const history = [run({ task: 'Monthly', date: iso(lastMonth) })];
  const n = new Notifier();
  n.update(data({ history }), s);
  assert.ok(calls.info.some(c => /Monthly Load is due/.test(c.message)),
    `no reminder on the first pass: ${calls.info.map(c => c.message).join(' | ')}`);

  const after = calls.info.length;
  n.update(data({ history }), s);
  assert.equal(calls.info.length, after, 'and exactly once per due date, not once per refresh');
  n.dispose();
});

test('the event file records the most serious transition when several land together', () => {
  // writeEvent overwrites one fixed path, so two scripts transitioning inside the same debounce
  // used to leave whichever came last in slot order — as likely as not the failure, which is the
  // entire reason anything watches this file.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spd-events-'));
  try {
    vscode.__reset();
    const s = N();
    s.events = { file: true };
    const n = new Notifier();
    n.logsDir = dir;
    n.update(data({ tasks: [task({ task: 'A' }), task({ task: 'B' })] }), s);
    n.update(data({ tasks: [task({ task: 'A', status: 'complete' }), task({ task: 'B', status: 'failed' })] }), s);
    const written = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    assert.equal(written.length, 1, `expected one event file, got ${written.join(', ')}`);
    const ev = JSON.parse(fs.readFileSync(path.join(dir, written[0]), 'utf8'));
    assert.equal(ev.event, 'failed', 'a completion must never displace a failure');
    assert.equal(ev.task, 'B');
    n.dispose();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('no event file is written when the feature is off', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spd-events-'));
  try {
    vscode.__reset();
    const n = new Notifier();
    n.logsDir = dir;
    const s = N();
    n.update(data({ tasks: [task()] }), s);
    n.update(data({ tasks: [task({ status: 'failed' })] }), s);
    assert.deepEqual(fs.readdirSync(dir), []);
    n.dispose();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the progress mirror stays with one run instead of flipping between two', () => {
  // 🔴 DataReader sorts by updatedAt, so with two scripts running the "first" one flipped to
  // whichever wrote its slot most recently. Every flip resolved the native toast and opened a new
  // one — once a second, for as long as both were running.
  vscode.__reset();
  const s = N({ mirrorProgress: true });
  const n = new Notifier();
  const a = (u) => task({ task: 'A', runId: 'a1', updatedAt: u });
  const b = (u) => task({ task: 'B', runId: 'b1', updatedAt: u });

  n.update(data({ tasks: [a(minutesAgo(0)), b(minutesAgo(1))] }), s);
  assert.equal(calls.progress.length, 1);
  const first = calls.progress[0];
  assert.match(String(first.options.title), /Script Progress: A/);

  // B now writes most recently, so DataReader puts it first. The mirror must not follow.
  n.update(data({ tasks: [b(minutesAgo(0)), a(minutesAgo(1))] }), s);
  assert.equal(calls.progress.length, 1, 'a second toast was opened');
  assert.equal(first.options.title, 'Script Progress: A', 'the one toast still names the run it started on');

  // When A ends, the mirror is free to move to B.
  n.update(data({ tasks: [b(minutesAgo(0))] }), s);
  assert.equal(calls.progress.length, 2);
  assert.match(String(calls.progress[1].options.title), /Script Progress: B/);
  n.dispose();
});

test('the mirror closes when the run ends, and on dispose', async () => {
  // `resolved` is recorded from a .then() on the promise the extension hands back, so it lands a
  // microtask later than the update that resolves it. Asserting synchronously read `false` every
  // time — which would have passed just as happily against a mirror that never closed at all.
  const settle = () => new Promise(r => setImmediate(r));
  vscode.__reset();
  const s = N({ mirrorProgress: true });
  const n = new Notifier();
  n.update(data({ tasks: [task({ runId: 'r1' })] }), s);
  assert.equal(calls.progress.length, 1);
  n.update(data({ tasks: [task({ runId: 'r1', status: 'complete' })] }), s);
  await settle();
  assert.equal(calls.progress[0].resolved, true, 'a finished run must not leave a toast spinning');

  n.update(data({ tasks: [task({ runId: 'r2' })] }), s);
  n.dispose();
  await settle();
  assert.equal(calls.progress[1].resolved, true, 'dispose must not leave one behind either');
});

test('no mirror at all when the setting is off', () => {
  vscode.__reset();
  const n = new Notifier();
  n.update(data({ tasks: [task()] }), N({ mirrorProgress: false }));
  assert.equal(calls.progress.length, 0);
  n.dispose();
});

test('a task that disappears is forgotten, so its return is a first sight again', () => {
  vscode.__reset();
  const s = N();
  const n = new Notifier();
  n.update(data({ tasks: [task({ runId: 'r1' })] }), s);
  n.update(data({ tasks: [] }), s);                                    // slot pruned
  n.update(data({ tasks: [task({ runId: 'r1', status: 'failed' })] }), s);
  assert.equal(calls.error.length, 0, 'a re-appearing slot is not a transition anyone watched');
  n.dispose();
});

// ================================================================ scopeCheck.ts — the warning

function ctx(dismissed = false) {
  const store = new Map();
  if (dismissed) store.set('scriptProgress.scopeWarningDismissed', true);
  return { workspaceState: { get: (k) => store.get(k), update: (k, v) => { store.set(k, v); return Promise.resolve(); } }, __store: store };
}
/** A window opened from a .code-workspace, with a folder value the extension will never read. */
function ignoredSetting(folderValue = [{ label: 'x', command: 'y' }]) {
  vscode.__reset();
  vscode.workspace.workspaceFile = vscode.Uri.file('C:/ws/p.code-workspace');
  vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file('C:/ws/app'), name: 'app', index: 0 }];
  vscode.workspace.getConfiguration = () => ({
    get: (_k, d) => d,
    inspect: (key) => (key === 'quickActions.buttons' ? { workspaceFolderValue: folderValue, workspaceValue: undefined } : undefined),
    update: () => Promise.resolve(),
  });
}

test('the scope warning names the setting, the folder and the fix', async () => {
  ignoredSetting();
  await warnAboutIgnoredSettings(ctx());
  assert.equal(calls.warn.length, 1);
  const m = calls.warn[0].message;
  assert.match(m, /"quickActions\.buttons" is set in app\/\.vscode\/settings\.json/);
  assert.match(m, /opened from a workspace file/, 'the cause, not just the symptom');
  assert.match(m, /Move it into the workspace file's "settings" block/, 'and what to do about it');
  assert.deepEqual(calls.warn[0].actions, ['Open workspace file', 'Open folder settings', "Don't show again"]);
});

test('it stays quiet when there is nothing to report', async () => {
  vscode.__reset();
  vscode.workspace.workspaceFile = undefined;   // an ordinary single-folder window
  await warnAboutIgnoredSettings(ctx());
  assert.equal(calls.warn.length, 0);
});

test('once dismissed it never warns again', async () => {
  ignoredSetting();
  await warnAboutIgnoredSettings(ctx(true));
  assert.equal(calls.warn.length, 0, 'a user who has decided to live with it should not be nagged');
});

test('"Don\'t show again" is remembered', async () => {
  ignoredSetting();
  const c = ctx();
  vscode.__answers.push("Don't show again");
  await warnAboutIgnoredSettings(c);
  assert.equal(c.__store.get('scriptProgress.scopeWarningDismissed'), true);
  assert.equal(calls.opened.length, 0, 'and it opens nothing');
});

test('"Open workspace file" opens the workspace file', async () => {
  ignoredSetting();
  vscode.__answers.push('Open workspace file');
  await warnAboutIgnoredSettings(ctx());
  assert.deepEqual(calls.opened, ['C:/ws/p.code-workspace']);
});

test('"Open folder settings" opens the file, and falls back when it is not there', async () => {
  ignoredSetting();
  vscode.__answers.push('Open folder settings');
  await warnAboutIgnoredSettings(ctx());
  assert.match(calls.opened[0], /C:\/ws\/app\/\.vscode\/settings\.json$/);

  ignoredSetting();
  vscode.window.showTextDocument = () => Promise.reject(new Error('ENOENT'));
  vscode.__answers.push('Open folder settings');
  await warnAboutIgnoredSettings(ctx());
  assert.ok(calls.commands.some(c => c.id === 'workbench.action.openWorkspaceSettingsFile'),
    'a missing file must still get the user somewhere useful');
});

test('dismissing the toast without choosing does nothing at all', async () => {
  ignoredSetting();
  const c = ctx();
  await warnAboutIgnoredSettings(c);            // no queued answer: the user closed it
  assert.equal(c.__store.size, 0, 'closing a toast is not "never show me this again"');
  assert.equal(calls.opened.length, 0);
});

// ================================================================ logic/digestHtml.ts

const digest = (over = {}) => digestHtml(data(over.data || {}), over.settings || S(), over.now || NOW, over.days ?? 7);

test('the digest carries no stylesheet dependency', () => {
  // Every mail client strips <style> blocks; anything that depended on one would arrive naked.
  const html = digest({ data: { history: [run()] } });
  assert.doesNotMatch(html, /<style|class=/, 'inline styles only');
  assert.match(html, /style="/);
});

test('a future-dated run does not count toward this week', () => {
  // 🔴 A clock-skewed container is the ordinary cause. Without an upper bound the run counted in
  // the headline stats while coverage(), called from this same function, excluded it — so one
  // email carried two mutually exclusive claims about the same week.
  const future = iso(NOW.getTime() + 3 * 86400000);
  const html = digest({ data: { history: [run({ date: daysAgoNoon(1) }), run({ date: future })] } });
  const runsCell = html.match(/>(\d+)<\/div><div style="font-size:11px[^>]*>runs</);
  assert.ok(runsCell, 'could not find the runs stat');
  assert.equal(runsCell[1], '1', 'a run dated three days from now is not part of this week');
});

test('the headline stats colour only what is actually wrong', () => {
  // 🔴 Scoped to the stat block. Asserting on the whole document could not tell the difference:
  // the by-script table colours its own failure count red, so the page contained #cf222e whether
  // or not the headline stat did, and the mutation that forced the stat green went undetected.
  const statBlock = (html) => html.slice(0, html.indexOf('<h3'));
  const statFor = (html, label) => {
    const m = statBlock(html).match(new RegExp(`color:(#[0-9a-f]{6})">\\d+</div><div[^>]*>${label}<`));
    return m && m[1];
  };
  const clean = digest({ data: { history: [run()] } });
  assert.equal(statFor(clean, 'failed'), '#1a7f37', 'green when nothing failed');
  assert.equal(statFor(clean, 'warnings'), '#57606a', 'grey, not amber, at zero');

  const bad = digest({ data: { history: [run({ success: false }), run({ warnings: 2 })] } });
  assert.equal(statFor(bad, 'failed'), '#cf222e', 'a failure is red');
  assert.equal(statFor(bad, 'warnings'), '#9a6700', 'a warning is amber');
});

test('with nothing in the window it says so instead of an empty table', () => {
  const html = digest({ data: { history: [run({ date: daysAgoNoon(40) })] } });
  assert.match(html, /Nothing ran in this window/);
  assert.doesNotMatch(html, /<table style="border-collapse:collapse;width:100%/);
});

test('the by-script table is ordered by how much each script ran', () => {
  const html = digest({
    data: {
      history: [
        run({ task: 'Quiet' }),
        run({ task: 'Busy' }), run({ task: 'Busy' }), run({ task: 'Busy', success: false }),
      ],
    },
  });
  assert.ok(html.indexOf('>Busy<') < html.indexOf('>Quiet<'), 'the busiest script leads');
  assert.match(html, /Busy<\/td>\s*<td[^>]*>3<\/td>/, 'three runs');
});

test('failures are listed with their category and summary', () => {
  const html = digest({
    data: { history: [run({ success: false, category: 'timeout', summary: 'took too long' })] },
  });
  assert.match(html, /\[timeout\]/);
  assert.match(html, /took too long/);
});

test('the pending-actions list is capped and says how many it cut', () => {
  // Every capped list on the dashboard says when it was cut; this is the artefact that gets
  // pasted into an email to other people, and it silently under-reported outstanding work.
  // `actionable` is what makes a warning a pending action — an ordinary warning is history, not
  // an outstanding item, and only the flagged ones belong in a list headed "Needs attention".
  const history = [run({
    date: daysAgoNoon(1),
    warningItems: Array.from({ length: 20 }, (_, i) => ({ msg: `problem ${i}`, actionable: true, count: i + 1 })),
  })];
  const html = digest({ data: { history } });
  const items = (html.match(/<li style="margin:2px 0">/g) || []).length;
  assert.ok(items <= 12 + 1, `expected at most 12 action items, saw ${items}`);
  assert.match(html, /…and \d+ more — see the dashboard for the full list/);
});

test('overdue and blocked processes are named', () => {
  // 'unseen' is deliberately not 'overdue' — a process that has NEVER reported is usually one
  // nobody wired up, and calling that overdue every day trains people to ignore the section. So
  // both processes have run before; neither has run today.
  const s = S({
    processes: [
      { name: 'Ghost', label: 'Ghost Load', frequency: 'daily', dueHour: 0 },
      { name: 'Downstream', label: 'Downstream', frequency: 'daily', dueHour: 0, dependsOn: ['Ghost'] },
    ],
  });
  const history = [
    run({ task: 'Ghost', date: daysAgoNoon(3) }),
    run({ task: 'Downstream', date: daysAgoNoon(3) }),
  ];
  const html = digest({ settings: s, data: { history } });
  assert.match(html, /Overdue:/);
  assert.match(html, /Ghost Load/);
  assert.match(html, /Waiting on something upstream:/);
  assert.match(html, /Downstream/);
});

test('everything from a script is escaped', () => {
  const html = digest({
    data: { history: [run({ task: '<script>alert(1)</script>', success: false, summary: '"quoted" & <b>' })] },
  });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&quot;quoted&quot; &amp; &lt;b&gt;/);
});

test('the digest says the figures are self-reported', () => {
  assert.match(digest({ data: { history: [run()] } }), /Figures are what the scripts themselves reported/);
});

// ================================================================ richClipboard — the other platforms

test('every platform either copies or explains why it did not', async () => {
  // The module's whole contract is that it never throws, never hangs, and never silently falls
  // back to plain text — because the caller has a working fallback and a wall of tags reaching a
  // colleague is the failure this exists to avoid. The non-Windows branches had never been run.
  const { copyHtmlRich } = require(path.join(repo, 'out/richClipboard.js'));
  const real = process.platform;
  try {
    for (const platform of ['linux', 'darwin', 'freebsd']) {
      Object.defineProperty(process, 'platform', { value: platform, configurable: true });
      const r = await copyHtmlRich('<p>spd test</p>');
      assert.equal(typeof r.ok, 'boolean', `${platform} returned no verdict`);
      if (!r.ok) {
        assert.ok(r.reason.length > 0, `${platform} failed with no reason to show the user`);
        assert.doesNotMatch(r.reason, /undefined|\[object/, `${platform} reason: ${r.reason}`);
      }
    }
    // Linux with no xclip must name the package, not just fail.
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    const linux = await copyHtmlRich('<p>x</p>');
    if (!linux.ok && !fs.existsSync('/usr/bin/xclip')) {
      assert.match(linux.reason, /xclip/, 'the fix has to be nameable');
    }
  } finally {
    Object.defineProperty(process, 'platform', { value: real, configurable: true });
  }
});
