// A `vscode` module good enough to load and exercise the extension-coupled files in plain Node.
//
// 🔴 Why this exists. The 2026-09-04 review's brief said a finding needed an executed
// reproduction, and six source files cannot be executed at all outside the extension host — so
// those six produced zero findings, and the review read that as "these are clean". They were not:
// the completeness critic wrote a stub like this one and immediately found a fourth instance of
// the silent-wipe class in simulate.ts. A rule about evidence had quietly become a rule about
// which files get looked at.
//
// It records what was shown to the user instead of showing it, so a test can assert on the toast
// that was raised rather than only on the state that was written.
'use strict';

const calls = { info: [], warn: [], error: [], progress: [], commands: [] };

class MarkdownString {
  constructor(value = '') { this.value = value; this.isTrusted = false; this.supportThemeIcons = false; }
  appendMarkdown(v) { this.value += v; return this; }
  appendText(v) { this.value += v; return this; }
}

class ThemeColor {
  constructor(id) { this.id = id; }
}

class StatusBarItem {
  constructor(alignment, priority) {
    this.alignment = alignment;
    this.priority = priority;
    this.text = '';
    this.tooltip = undefined;
    this.command = undefined;
    this.backgroundColor = undefined;
    this.visible = false;
  }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  dispose() { this.disposed = true; }
}

const record = (bucket) => (message, ...rest) => {
  calls[bucket].push({ message, actions: rest.filter(x => typeof x === 'string') });
  return Promise.resolve(undefined);   // nobody clicked anything
};

const vscode = {
  StatusBarAlignment: { Left: 1, Right: 2 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  MarkdownString,
  ThemeColor,
  Disposable: class { constructor(fn) { this._fn = fn; } dispose() { if (this._fn) this._fn(); } },
  Uri: { file: (p) => ({ fsPath: p, scheme: 'file', toString: () => p }) },
  EventEmitter: class {
    constructor() { this.listeners = []; this.event = (l) => { this.listeners.push(l); return { dispose: () => {} }; }; }
    fire(e) { for (const l of this.listeners) l(e); }
    dispose() {}
  },
  window: {
    createStatusBarItem: (alignment, priority) => new StatusBarItem(alignment, priority),
    showInformationMessage: record('info'),
    showWarningMessage: record('warn'),
    showErrorMessage: record('error'),
    // Runs the task immediately with a progress object that records what it was told, and hands
    // back a resolve hook the way the real API does.
    withProgress: (options, task) => {
      const entry = { options, reports: [], resolved: false };
      calls.progress.push(entry);
      const progress = { report: (r) => entry.reports.push(r) };
      const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => {} }) };
      const done = task(progress, token);
      Promise.resolve(done).then(() => { entry.resolved = true; }, () => { entry.resolved = true; });
      return done;
    },
    activeTextEditor: undefined,
    terminals: [],
    createTerminal: () => ({ show() {}, sendText() {}, dispose() {}, name: 'Script Progress', exitStatus: undefined }),
  },
  workspace: {
    isTrusted: true,
    workspaceFolders: undefined,
    getConfiguration: () => ({ get: (_k, d) => d, inspect: () => undefined, update: () => Promise.resolve() }),
  },
  commands: {
    executeCommand: (id, ...args) => { calls.commands.push({ id, args }); return Promise.resolve(undefined); },
    registerCommand: () => ({ dispose: () => {} }),
  },
  tasks: { onDidEndTaskProcess: () => ({ dispose: () => {} }) },
  env: { shell: process.platform === 'win32' ? 'C:\\Windows\\System32\\cmd.exe' : '/bin/bash', clipboard: { writeText: () => Promise.resolve() } },
};

vscode.__calls = calls;
vscode.__reset = () => { for (const k of Object.keys(calls)) calls[k].length = 0; };

/**
 * Make `require('vscode')` resolve to this stub for the rest of the process.
 *
 * The compiled modules do a plain `require('vscode')`, which has no file on disk, so the loader
 * itself has to be taught the name. This is the whole trick, and it is five lines.
 */
function install() {
  const Module = require('module');
  const original = Module._load;
  if (Module._load.__spdStubbed) return vscode;
  Module._load = function (request, parent, isMain) {
    if (request === 'vscode') return vscode;
    return original.apply(this, arguments);
  };
  Module._load.__spdStubbed = true;
  return vscode;
}

module.exports = { vscode, install, calls };
