// The extension-coupled surface, exercised in plain Node through a `vscode` stub.
//
// 🔴 These files had no tests and, for the same reason, no findings: they cannot be loaded outside
// the extension host, so every review that required an executed reproduction skipped them and read
// the silence as cleanliness. The completeness critic wrote a stub, loaded them, and found a
// silent data-loss bug in the first one it looked at. Everything below is from the 2026-09-04
// review's batch E plus that critic's finding.
//
// These modules take their own clock (`new Date()` inside update()), so the fixtures below are
// built relative to the real now rather than pinned to a fixed instant.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const { install, calls } = require('./fixtures/vscode-stub.js');
install();

const { StatusBarManager } = require(path.join(repo, 'out/statusBar.js'));
const { Notifier } = require(path.join(repo, 'out/notifications.js'));
const { simulateRun } = require(path.join(repo, 'out/simulate.js'));
const { settings: S } = require('./fixtures/settings.js');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'spd-ext-'));
const iso = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
const base = { progress: null, tasks: [], history: [], deltas: {}, impact: {}, access: null,
  overlays: [], logsDir: 'x', logsDirExists: true, readErrors: [] };
const task = (over = {}) => ({
  task: 'Nightly Load', status: 'running', step: 1, totalSteps: 3, label: 'Extract', detail: '',
  elapsed: 12, eta: null, warnings: [], log: [], metrics: {}, artifacts: [], accessed: [],
  updatedAt: iso(new Date()), startedAt: iso(new Date(Date.now() - 12000)), runId: 'r1', ...over,
});
const notifySettings = (over = {}) => {
  const s = S({});
  s.notifications = { onComplete: false, onFail: false, onStall: false, onWarning: false,
    onExit: false, onSlow: false, mirrorProgress: false, ...over };
  return s;
};

// ---------------------------------------------------------------- the critic's finding
test('a BOM in run_history.json no longer costs the user their history', async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'progress'), { recursive: true });
  const histFile = path.join(dir, 'run_history.json');
  const real = [];
  for (let i = 1; i <= 40; i++) real.push({ task: 'Revenue Load', date: `2026-08-${String((i % 28) + 1).padStart(2, '0')}T09:00:00`, success: true, elapsed: 30, warnings: 0, summary: 'real work' });
  // A UTF-8 BOM is what PowerShell's `Set-Content -Encoding utf8` and Notepad write, and the
  // dashboard renders such a file perfectly because DataReader strips one. So nothing warned the
  // user that anything was wrong — right up until forty runs became one, from a menu command whose
  // whole purpose is to be safe to click.
  fs.writeFileSync(histFile, '﻿' + JSON.stringify(real), 'utf8');

  await simulateRun(dir, { ...base }, 30, 'ok');
  const after = JSON.parse(fs.readFileSync(histFile, 'utf8').replace(/^﻿/, ''));
  assert.equal(after.length, 41, `expected the 40 real runs plus the simulated one, got ${after.length}`);
  assert.equal(after.filter(r => r.task === 'Revenue Load').length, 40);
});

test('Simulate a Demo Run stops rather than replacing a file it genuinely cannot read', async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'progress'), { recursive: true });
  const histFile = path.join(dir, 'run_history.json');
  fs.writeFileSync(histFile, '[{"task": "Revenue Load", truncated mid-write', 'utf8');
  // "Unreadable" is not "empty". Falling back to a default and writing it back is how the other
  // three instances of this bug destroyed data; here it must refuse and say so.
  await assert.rejects(() => simulateRun(dir, { ...base }, 30, 'ok'), /could not be read/);
  assert.match(fs.readFileSync(histFile, 'utf8'), /truncated mid-write/, 'the unreadable file was overwritten');
});

// ---------------------------------------------------------------- statusBar
test('a task name cannot inject a codicon into the status bar', () => {
  const bar = new StatusBarManager();
  // 🔴 StatusBarItem.text renders $(name) as an icon by documented contract — this file relies on
  // that for $(sync~spin) and $(error) — and progress.json is an open contract other producers
  // write. A task called "$(check) All good" put a green tick beside the word FAILED, on the one
  // line of this extension's UI that has to be trustworthy at a glance.
  bar.update({ ...base, progress: task({ status: 'failed', task: '$(check) All good' }) }, S({}));
  assert.match(bar.item.text, /FAILED/);
  assert.ok(!/\$\(check\)/.test(bar.item.text), `status bar text was: ${bar.item.text}`);
  bar.dispose?.();
});

test('a lone carriage return cannot restructure the tooltip', () => {
  const bar = new StatusBarManager();
  bar.update({ ...base, progress: task({ status: 'complete', detail: 'done\r\rEverything is fine.' }) }, S({}));
  const md = String((bar.item.tooltip && bar.item.tooltip.value) || '');
  // markdown-it normalises \r\n? and \n alike, so \r\r was still a paragraph break — enough for
  // file-controlled text to place an authoritative-looking sentence of its own in the tooltip.
  assert.ok(md.length > 0);
  assert.ok(!/\r/.test(md), 'a carriage return survived into the tooltip');
  bar.dispose?.();
});

// ---------------------------------------------------------------- notifications
test('onWarning keeps firing past the twentieth warning of a run', () => {
  const n = new Notifier();
  const settings = notifySettings({ onWarning: true });
  const twenty = Array.from({ length: 20 }, (_, i) => ({ time: iso(new Date()), msg: `w${i}` }));
  // The reporter trims the slot's ordinary warnings to 20 and carries the true figure in
  // warningsTotal, so comparing array LENGTHS saturates: cur.warnings > prev.warnings could never
  // be true again, and onWarning went quiet from the twentieth warning on — exactly the point at
  // which a run becomes worth watching.
  n.update({ ...base, tasks: [task({ warnings: twenty, warningsTotal: 20 })] }, settings);
  n.update({ ...base, tasks: [task({ warnings: twenty, warningsTotal: 20 })] }, settings);
  calls.warn.length = 0;
  n.update({ ...base, tasks: [task({ warnings: twenty, warningsTotal: 21 })] }, settings);
  assert.equal(calls.warn.length, 1, `expected one warning toast, got ${JSON.stringify(calls.warn)}`);
  n.dispose?.();
});

test('a due-date reminder actually fires', () => {
  const n = new Notifier();
  const now = new Date();
  // Due in two days, with a three-day reminder window: inside the window right now.
  const due = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
  const settings = notifySettings();
  settings.processes = [{ name: 'Close', label: 'Close', frequency: 'monthly', dayOfMonth: due.getDate(), reminderDays: 3 }];
  calls.info.length = 0;
  // 🔴 The key used to be added to `reminded` BEFORE the "do not fire on activation" guard, so a
  // process already inside its window when the window opened was marked reminded without ever
  // producing a toast. A fresh window is opened every day and reminder windows are days long, so
  // that was the normal case: the reminderDays feature never fired at all.
  // A prior run in an earlier period, so the row is 'pending' rather than 'unseen' — dueReminders
  // deliberately says nothing about a process that has never run, which is a different message.
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, due.getDate(), 9, 0, 0);
  n.update({ ...base, history: [{ task: 'Close', date: iso(lastMonth), success: true, elapsed: 30, warnings: 0, summary: '' }] }, settings);
  assert.ok(calls.info.some(c => /Close is due/.test(c.message)),
    `no reminder fired: ${JSON.stringify(calls.info)}`);
  n.dispose?.();
});

test('the SLA warning is not silenced for ever by a producer with no run id', () => {
  const n = new Notifier();
  const settings = notifySettings({ onSlow: true });
  settings.processes = [{ name: 'Nightly Load', label: 'N', frequency: 'daily', maxMinutes: 1 }];
  // runId and startedAt are both documented Optional, so a producer that writes neither gives
  // every run of the script the identical `seen` key — and the SLA-warned flag was inherited
  // straight across, silencing onSlow after the first run that ever blew its limit.
  const bare = (elapsed) => task({ runId: undefined, startedAt: undefined, elapsed });
  n.update({ ...base, tasks: [bare(600)] }, settings);
  n.update({ ...base, tasks: [bare(620)] }, settings);
  calls.warn.length = 0;
  n.update({ ...base, tasks: [bare(5)] }, settings);        // elapsed went BACKWARDS: a new run
  n.update({ ...base, tasks: [bare(600)] }, settings);
  assert.equal(calls.warn.length, 1, `the second run never warned: ${JSON.stringify(calls.warn)}`);
  n.dispose?.();
});
