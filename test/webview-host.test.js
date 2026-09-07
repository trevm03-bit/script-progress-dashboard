// The six files nothing had ever loaded.
//
// 🔴 A coverage sweep after the 2026-09-04 fix pass found six source files — 38 KB — that no test
// and not the release gate so much as named. `dashboardHost.ts` is the largest of them and is the
// thing that decides what reaches the webview at all: every message the page can send arrives
// here, and every update the page shows leaves from here. It had no test.
//
// The pattern by this point was established: every unexamined corner of this codebase has held
// something real. These are the tests that examine them.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const { install, calls } = require('./fixtures/vscode-stub.js');
const vscode = install();

const { DashboardHost } = require(path.join(repo, 'out/dashboardHost.js'));
const { renderAccessMap } = require(path.join(repo, 'out/render/accessMapSummary.js'));
const { findIgnoredFolderSettings } = require(path.join(repo, 'out/scopeCheck.js'));
const { settings: S } = require('./fixtures/settings.js');

const base = { progress: null, tasks: [], history: [], deltas: {}, impact: {}, access: null,
  overlays: [], logsDir: 'C:/ws/logs', logsDirExists: true, readErrors: [] };
const run = (over = {}) => ({ task: 'Nightly', date: '2026-09-02T09:00:00', success: true,
  elapsed: 30, warnings: 0, summary: 'ok', ...over });

/** A host wired to fixed state, with a webview that records instead of posting. */
function makeHost(over = {}) {
  vscode.__reset();
  const state = {
    data: { ...base, ...(over.data || {}) },
    settings: over.settings || S(),
    collapsedIds: [],
    getData() { return this.data; },
    getSettings() { return this.settings; },
    runner: { runButton: async (b) => calls.commands.push({ id: '__runButton', args: [b] }) },
    getCollapsed() { return this.collapsedIds; },
    setCollapsed(ids) { this.collapsedIds = ids; },
  };
  const host = new DashboardHost(vscode.Uri.file('C:/ext'), over.surface || 'panel', state);
  const webview = vscode.makeWebview();
  host.attach(webview);
  return { host, webview, state };
}

// ---------------------------------------------------------------- the page shell
test('the page shell locks the webview down', () => {
  const { webview } = makeHost();
  const csp = (webview.html.match(/content="([^"]*)"/) || [, ''])[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /base-uri 'none'/, 'a page that can retarget its base can load anything');
  assert.match(csp, /form-action 'none'/);
  // Scripts run by nonce only. 'unsafe-inline' anywhere in script-src would make the nonce
  // decorative, and this page renders text that scripts and log files control.
  const scriptSrc = (csp.match(/script-src ([^;]*)/) || [, ''])[1];
  assert.match(scriptSrc, /'nonce-[A-Za-z0-9+/=]{16,}'/);
  assert.doesNotMatch(scriptSrc, /unsafe-inline|unsafe-eval|\*/);
  // Every <script> must carry that nonce, or CSP silently drops it and the page never wakes up.
  const nonce = (scriptSrc.match(/'nonce-([^']+)'/) || [, ''])[1];
  const scripts = webview.html.match(/<script[^>]*>/g) || [];
  assert.ok(scripts.length >= 2, `expected the two page scripts, got ${scripts.length}`);
  for (const tag of scripts) assert.ok(tag.includes(`nonce="${nonce}"`), `script without the nonce: ${tag}`);
});

test('each shell gets its own nonce', () => {
  const a = makeHost().webview.html.match(/nonce-([^']+)'/)[1];
  const b = makeHost().webview.html.match(/nonce-([^']+)'/)[1];
  assert.notEqual(a, b, 'a fixed nonce is the same as no nonce');
});

// ---------------------------------------------------------------- the update contract
test('refresh posts once, stays quiet when nothing changed, and speaks again when forced', () => {
  const { host } = makeHost({ data: { history: [run()] } });
  calls.posted.length = 0;
  host.refresh();
  assert.equal(calls.posted.length, 1, 'the first refresh must post');
  const first = calls.posted[0];
  assert.equal(first.type, 'update');
  assert.equal(typeof first.sections, 'string');

  // 🔴 The whole reason this page is updated by postMessage rather than reloaded: an unchanged
  // render must not be posted, or the webview rebuilds every second and loses scroll, filters and
  // the map's layout.
  calls.posted.length = 0;
  host.refresh();
  assert.equal(calls.posted.length, 0, 'an unchanged render was posted anyway');

  host.refresh(true);
  assert.equal(calls.posted.length, 1, 'a forced refresh must post regardless');
});

test('a hidden surface is not rendered at all', () => {
  const { host } = makeHost({ data: { history: [run()] } });
  host.setVisible(false);
  calls.posted.length = 0;
  host.refresh(true);
  assert.equal(calls.posted.length, 0, 'work was done for a surface nobody can see');
  // …and becoming visible again catches it up without being asked.
  host.setVisible(true);
  assert.equal(calls.posted.length, 1);
});

test('the status the page shows matches the data it was given', () => {
  const { host } = makeHost({ data: { history: [run({ success: false })], progress: {
    task: 'Nightly', status: 'failed', step: 1, totalSteps: 1, label: 'done', detail: '',
    elapsed: 5, eta: null, warnings: [], log: [], metrics: {}, artifacts: [], accessed: [],
    updatedAt: '2026-09-02T09:00:05',
  } } });
  calls.posted.length = 0;
  host.refresh(true);
  const msg = calls.posted[0];
  assert.equal(msg.state, 'failed');
  assert.equal(msg.status.state, 'failed');
  assert.match(msg.status.text, /last run failed/);
  assert.equal(msg.status.logsDir, 'C:/ws/logs');
});

// ---------------------------------------------------------------- messages from the page
test('attaching twice does not leave the old listener handling messages', async () => {
  // 🔴 attach() pushes its subscription onto a list that only dispose() clears, so a second attach
  // without a dispose would run every message twice — a doubled command per click. The sidebar
  // provider disposes first, which is what makes this safe; this pins that contract down rather
  // than leaving it to a comment in another file.
  const { host, webview } = makeHost();
  const second = vscode.makeWebview();
  host.attach(second);
  calls.commands.length = 0;
  await second.__send({ type: 'openLogs' });
  assert.equal(calls.commands.filter(c => c.id === 'scriptProgress.openLogsFolder').length, 1);
  assert.equal(webview.__listenerCount(), 1, 'the first webview kept its listener');
  // And after dispose, nothing is left listening anywhere.
  host.dispose();
  assert.equal(second.__listenerCount(), 0);
});

test('every plain page message maps to exactly one command', async () => {
  const { webview } = makeHost();
  const expected = {
    exportCsv: 'scriptProgress.exportHistoryCsv', exportReport: 'scriptProgress.exportReport',
    openPanel: 'scriptProgress.openPanel', openMap: 'scriptProgress.openMap',
    openLogs: 'scriptProgress.openLogsFolder', refresh: 'scriptProgress.refresh',
    settings: 'scriptProgress.openSettings', sections: 'scriptProgress.toggleSections',
    simulate: 'scriptProgress.simulateRun', copySummary: 'scriptProgress.copyDailySummary',
    walkthrough: 'scriptProgress.openWalkthrough', layout: 'scriptProgress.chooseLayout',
  };
  for (const [type, command] of Object.entries(expected)) {
    calls.commands.length = 0;
    await webview.__send({ type });
    assert.deepEqual(calls.commands.map(c => c.id), [command], `message "${type}"`);
  }
});

test('an unknown message does nothing at all', async () => {
  const { webview } = makeHost();
  calls.commands.length = 0;
  await webview.__send({ type: 'definitelyNotAThing' });
  await webview.__send({});
  await webview.__send(null);
  assert.deepEqual(calls.commands, []);
});

test('runAction can only reach a button that is actually configured', async () => {
  const { webview } = makeHost({ settings: S({ buttons: [{ label: 'Fix', command: 'python fix.py' }] }) });
  calls.commands.length = 0;
  await webview.__send({ type: 'runAction', index: 0 });
  assert.equal(calls.commands.filter(c => c.id === '__runButton').length, 1);
  // Out of range, negative and non-numeric indexes must all reach nothing. The page is the one
  // place an index can be invented.
  for (const index of [1, 99, -1, '0', null, undefined, 1.5]) {
    calls.commands.length = 0;
    await webview.__send({ type: 'runAction', index });
    assert.deepEqual(calls.commands, [], `index ${JSON.stringify(index)} reached a button`);
  }
});

test('the settings message writes only values from its own allow-list', async () => {
  const { webview } = makeHost();
  calls.configUpdates.length = 0;
  const updates = [];
  vscode.workspace.getConfiguration = () => ({
    get: (_k, d) => d, inspect: () => undefined,
    update: (k, v) => { updates.push({ k, v }); return Promise.resolve(); },
  });

  await webview.__send({ type: 'setting', id: 'accessMap.layout', value: 'radial' });
  assert.deepEqual(updates, [{ k: 'accessMap.layout', v: 'radial' }]);

  // 🔴 Anything else must be refused. This message comes from the page, and the page renders text
  // that scripts and log files control, so an unfiltered settings write would let a log file
  // change the user's configuration.
  updates.length = 0;
  for (const bad of [
    { id: 'accessMap.layout', value: 'evil' },
    { id: 'accessMap.labels', value: '../../../etc' },
    { id: 'quickActions.buttons', value: 'anything' },
    { id: 'accessMap.timeWindowDays', value: '7; rm -rf /' },
    { id: 'accessMap.timeWindowDays', value: '-1' },
    { id: 'constructor', value: 'x' },
    { id: 'accessMap.layout', value: 42 },
  ]) {
    await webview.__send({ type: 'setting', ...bad });
  }
  assert.deepEqual(updates, [], `a setting escaped the allow-list: ${JSON.stringify(updates)}`);

  // The numeric one is allowed, but only as digits.
  await webview.__send({ type: 'setting', id: 'accessMap.timeWindowDays', value: '7' });
  assert.deepEqual(updates, [{ k: 'accessMap.timeWindowDays', v: 7 }]);
  assert.equal(typeof updates[0].v, 'number', 'the setting was written as a string');
});

test('copy is bounded, and savePng only accepts a PNG', async () => {
  const { webview } = makeHost();
  calls.written.length = 0;
  await webview.__send({ type: 'copy', text: 'a short label' });
  assert.equal(calls.written.filter(w => w.clipboard).length, 1);
  await webview.__send({ type: 'copy', text: 'x'.repeat(5000) });
  assert.equal(calls.written.filter(w => w.clipboard).length, 1, 'an unbounded paste was accepted');

  // savePng decodes base64 and writes it to disk, so the shape is the only thing between the page
  // and an arbitrary file write.
  vscode.__saveTarget = vscode.Uri.file('C:/ws/logs/map.png');
  calls.written.length = 0;
  for (const data of ['not a data uri', 'data:text/html;base64,PHNjcmlwdD4=',
    'data:image/png;base64,<script>', 'data:image/svg+xml;base64,AAAA', '', null]) {
    await webview.__send({ type: 'savePng', data });
  }
  assert.deepEqual(calls.written.filter(w => w.path), [], 'a non-PNG payload was written to disk');
  await webview.__send({ type: 'savePng', data: 'data:image/png;base64,aGVsbG8=' });
  assert.equal(calls.written.filter(w => w.path).length, 1);
});

test('a cancelled save dialog writes nothing', async () => {
  const { webview } = makeHost();
  vscode.__saveTarget = undefined;          // the user pressed Escape
  calls.written.length = 0;
  await webview.__send({ type: 'savePng', data: 'data:image/png;base64,aGVsbG8=' });
  assert.deepEqual(calls.written.filter(w => w.path), []);
});

// ---------------------------------------------------------------- artifacts
test('artifacts are never opened in an untrusted workspace', async () => {
  const { webview } = makeHost();
  vscode.workspace.isTrusted = false;
  vscode.__files.add('C:/ws/report.txt');
  calls.opened.length = 0; calls.warn.length = 0;
  await webview.__send({ type: 'openFile', path: 'C:/ws/report.txt' });
  assert.deepEqual(calls.opened, [], 'a file was opened in an untrusted workspace');
  assert.match(calls.warn[0].message, /untrusted/);
});

test('an executable is revealed, never opened', async () => {
  const { webview } = makeHost();
  for (const name of ['payload.exe', 'run.bat', 'go.cmd', 'x.ps1', 'y.vbs', 'z.js', 'a.scr', 'l.lnk']) {
    vscode.__reset();
    vscode.__files.add(`C:/ws/${name}`);
    await webview.__send({ type: 'openFile', path: `C:/ws/${name}` });
    assert.deepEqual(calls.opened, [], `${name} was opened in the editor`);
    assert.deepEqual(calls.externals, [], `${name} was handed to the OS to run`);
    assert.equal(calls.revealed.length, 1, `${name} was not revealed`);
  }
});

test('an office document needs a modal yes, and takes no for an answer', async () => {
  const { webview } = makeHost();
  vscode.__files.add('C:/ws/report.xlsx');
  calls.externals.length = 0;
  await webview.__send({ type: 'openFile', path: 'C:/ws/report.xlsx' });
  assert.equal(calls.externals.length, 0, 'it opened without being confirmed');
  assert.ok(calls.info.some(c => c.modal), 'the confirmation was not modal');

  vscode.__answers.push('Open');
  await webview.__send({ type: 'openFile', path: 'C:/ws/report.xlsx' });
  assert.deepEqual(calls.externals, ['C:/ws/report.xlsx']);
});

test('a missing artifact says so instead of failing silently', async () => {
  const { webview } = makeHost();
  calls.warn.length = 0;
  await webview.__send({ type: 'openFile', path: 'C:/ws/nope.txt' });
  assert.match(calls.warn[0].message, /not found/);
});

// ---------------------------------------------------------------- accessMapSummary
test('the Access Map section offers a way forward when there is no data', () => {
  const html = renderAccessMap({ ...base }, S({ sections: { accessMap: true } }), new Date(), 'panel', {});
  assert.match(html, /No access\.json yet/);
  assert.match(html, /data-msg="simulate"/, 'the empty state has to offer the next step');
});

test('the sidebar gets a summary and a way in; the panel gets the canvas', () => {
  const access = { nodes: [
    { id: 'task:A', type: 'task', label: 'A', lastSeen: '2026-09-02T09:00:00' },
    { id: 'table:x', type: 'table', label: 'x', lastSeen: '2026-09-02T09:00:00' },
  ], edges: [{ from: 'task:A', to: 'table:x', mode: 'read', count: 1, lastSeen: '2026-09-02T09:00:00' }] };
  const s = S({ sections: { accessMap: true } });
  const side = renderAccessMap({ ...base, access }, s, new Date(2026, 8, 2, 10), 'sidebar', {});
  assert.match(side, /data-msg="openMap"/, 'the sidebar has to offer a way into the full map');
  // The sidebar gets a MINI preview, not the full toolbar-and-detail map. Both draw to a canvas,
  // so the class is what tells them apart.
  assert.match(side, /map-host-mini/);
  assert.doesNotMatch(side, /map-toolbar/, 'the sidebar drew the full map furniture');
  const panel = renderAccessMap({ ...base, access }, s, new Date(2026, 8, 2, 10), 'panel', {});
  assert.match(panel, /<canvas/);
  assert.doesNotMatch(panel, /map-host-mini/, 'the panel drew the sidebar preview');

  // sidebarPreview off means summary and button only — no canvas to keep alive in the sidebar.
  const quiet = S({ sections: { accessMap: true } });
  quiet.accessMap = { ...quiet.accessMap, sidebarPreview: false };
  assert.doesNotMatch(renderAccessMap({ ...base, access }, quiet, new Date(2026, 8, 2, 10), 'sidebar', {}), /<canvas/);
});

// ---------------------------------------------------------------- scopeCheck
test('folder-scoped settings are only reported when the two scopes can differ', () => {
  vscode.__reset();
  // A plain folder window: folder scope and workspace scope are the same file, so there is
  // nothing to warn about and warning would be noise.
  vscode.workspace.workspaceFile = undefined;
  vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file('C:/ws'), name: 'ws', index: 0 }];
  vscode.workspace.getConfiguration = () => ({
    get: (_k, d) => d,
    inspect: () => ({ workspaceFolderValue: [{ label: 'x', command: 'y' }], workspaceValue: undefined }),
    update: () => Promise.resolve(),
  });
  assert.deepEqual(findIgnoredFolderSettings(), []);

  // Opened from a .code-workspace: now a folder value really is invisible to the extension.
  vscode.workspace.workspaceFile = vscode.Uri.file('C:/ws/p.code-workspace');
  const found = findIgnoredFolderSettings();
  assert.ok(found.length > 0, 'a setting the extension will never read went unreported');
  assert.ok(found.every(f => f.key && f.folder), JSON.stringify(found[0]));

  // …unless workspace scope also sets it, in which case the folder value is a deliberate override.
  vscode.workspace.getConfiguration = () => ({
    get: (_k, d) => d,
    inspect: () => ({ workspaceFolderValue: [{ label: 'x' }], workspaceValue: [{ label: 'y' }] }),
    update: () => Promise.resolve(),
  });
  assert.deepEqual(findIgnoredFolderSettings(), []);
});

test('an empty folder value is not worth interrupting anyone about', () => {
  vscode.__reset();
  vscode.workspace.workspaceFile = vscode.Uri.file('C:/ws/p.code-workspace');
  vscode.workspace.workspaceFolders = [{ uri: vscode.Uri.file('C:/ws'), name: 'ws', index: 0 }];
  for (const empty of [[], {}, '', null]) {
    vscode.workspace.getConfiguration = () => ({
      get: (_k, d) => d,
      inspect: () => ({ workspaceFolderValue: empty, workspaceValue: undefined }),
      update: () => Promise.resolve(),
    });
    assert.deepEqual(findIgnoredFolderSettings(), [], `warned about ${JSON.stringify(empty)}`);
  }
});

// ---------------------------------------------------------------- richClipboard
//
// 🔴 The one thing this file exists to get right was wrong on every non-ASCII digest, and it was
// invisible from the outside: `SetData(DataFormats.Html, <string>)` serialises through the system
// ANSI code page while the four CF_HTML offsets are counted in UTF-8 BYTES, so the header pointed
// past the end of its own allocation and any character with no CP1252 mapping became "?" — silent
// corruption of a document the user forwards to colleagues, under a toast reporting success.
//
// Verified once against a real clipboard by reading the raw bytes back through Win32. That cannot
// live in this suite: it would overwrite the user's clipboard on every test run. What CAN live
// here is the shape whose absence caused it.
test('the clipboard writer hands Windows bytes, not a string', () => {
  const src = fs.readFileSync(path.join(repo, 'src/richClipboard.ts'), 'utf8');
  assert.match(src, /GetBytes\(\$cf\)/, 'the payload is not converted to bytes at all');
  assert.match(src, /MemoryStream/, 'CF_HTML must be written as a stream or .NET re-encodes it');
  assert.match(src, /SetData\(\[System\.Windows\.Forms\.DataFormats\]::Html, \$false, \$stream\)/,
    'the HTML flavour is not being set from the stream');
  assert.doesNotMatch(src, /SetData\(\[System\.Windows\.Forms\.DataFormats\]::Html, \$cf\)/,
    'the string overload is back, and it re-encodes through the ANSI code page');
  // The offsets have to be counted in the same units the bytes are written in.
  assert.match(src, /GetByteCount/);
  // Both flavours, so an app asking for plain text still gets something sensible.
  assert.match(src, /DataFormats\]::UnicodeText/);
});

test('the clipboard writer never throws, whatever it is handed', async () => {
  const { copyHtmlRich } = require(path.join(repo, 'out/richClipboard.js'));
  // It shells out on Windows, so this asserts the CONTRACT — a resolved result either way — rather
  // than the outcome, which depends on the machine. Nothing here touches the clipboard on a
  // platform without a helper, and on Windows the payload is a comment.
  for (const input of ['<!-- spd test -->', '']) {
    const r = await copyHtmlRich(input);
    assert.equal(typeof r.ok, 'boolean');
    assert.equal(typeof r.reason, 'string');
    if (!r.ok) assert.ok(r.reason.length > 0, 'a failure with no reason cannot be shown to anyone');
  }
});
