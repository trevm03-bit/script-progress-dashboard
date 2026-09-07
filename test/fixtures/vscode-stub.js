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

const calls = { info: [], warn: [], error: [], progress: [], commands: [], modal: [],
  posted: [], statusBar: [], opened: [], externals: [], revealed: [], written: [], configUpdates: [] };

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

// A test can queue the button a user 'clicks' next; otherwise nobody clicks anything.
const answers = [];
const record = (bucket) => (message, ...rest) => {
  const actions = rest.filter(x => typeof x === 'string');
  const modal = rest.some(x => x && typeof x === 'object' && x.modal);
  calls[bucket].push({ message, actions, modal });
  return Promise.resolve(answers.length ? answers.shift() : undefined);
};

const vscode = {
  StatusBarAlignment: { Left: 1, Right: 2 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  MarkdownString,
  ThemeColor,
  Disposable: class { constructor(fn) { this._fn = fn; } dispose() { if (this._fn) this._fn(); } },
  Uri: {
    file: (p) => ({ fsPath: p, scheme: 'file', path: String(p).replace(/\\/g, '/'), toString: () => p }),
    // Enough of joinPath for the shell's asset URIs and for artifact resolution. Uses forward
    // slashes throughout, which is what the real Uri does regardless of platform.
    joinPath: (base, ...parts) => {
      const joined = [String(base && base.fsPath ? base.fsPath : base).replace(/[\\/]+$/, ''), ...parts]
        .join('/').replace(/\\/g, '/');
      const out = [];
      for (const seg of joined.split('/')) {
        if (seg === '.' || seg === '') { if (out.length === 0) out.push(seg); continue; }
        if (seg === '..') { out.pop(); continue; }
        out.push(seg);
      }
      const p = out.join('/');
      return { fsPath: p, scheme: 'file', path: p, toString: () => p };
    },
  },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  ViewColumn: { Beside: -2, Active: -1, One: 1 },
  EventEmitter: class {
    constructor() { this.listeners = []; this.event = (l) => { this.listeners.push(l); return { dispose: () => {} }; }; }
    fire(e) { for (const l of this.listeners) l(e); }
    dispose() {}
  },
  /**
   * A Webview good enough to attach a DashboardHost to.
   *
   * Records what was posted rather than posting it, so a test can assert on the message the
   * extension decided to send -- which is the whole contract between the host and the page.
   */
  makeWebview() {
    const listeners = [];
    return {
      html: '',
      options: {},
      cspSource: 'vscode-webview://stub',
      asWebviewUri: (uri) => ({ toString: () => `vscode-webview://stub${uri.path || uri.fsPath}` }),
      postMessage: (m) => { calls.posted.push(m); return Promise.resolve(true); },
      onDidReceiveMessage: (fn) => {
        listeners.push(fn);
        return { dispose: () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
      },
      /** Deliver one message the way the page would, to EVERY listener still attached. */
      __send: (msg) => Promise.all(listeners.map(fn => fn(msg))),
      __listenerCount: () => listeners.length,
    };
  },

  window: {
    createStatusBarItem: (alignment, priority) => new StatusBarItem(alignment, priority),
    setStatusBarMessage: (text, ms) => { calls.statusBar.push({ text, ms }); return { dispose() {} }; },
    showTextDocument: (uri) => { calls.opened.push(String(uri.fsPath || uri)); return Promise.resolve({}); },
    showSaveDialog: (opts) => { calls.modal.push({ kind: 'save', opts }); return Promise.resolve(vscode.__saveTarget); },
    createWebviewPanel: (viewType, title, showOptions, options) => {
      // Kept, not discarded: a test needs to reveal it, dispose it, and read back what the
      // extension asked VS Code for (retainContextWhenHidden, localResourceRoots, the icon).
      const panel = {
        viewType, title, showOptions, options,
        webview: vscode.makeWebview(),
        visible: true,
        iconPath: undefined,
        __reveals: [],
        __onViewState: [],
        __onDispose: [],
        reveal: (col, preserveFocus) => { panel.__reveals.push({ col, preserveFocus }); },
        dispose: () => { for (const fn of panel.__onDispose) fn(); },
        onDidChangeViewState: (fn) => { panel.__onViewState.push(fn); return { dispose() {} }; },
        onDidDispose: (fn) => { panel.__onDispose.push(fn); return { dispose() {} }; },
      };
      vscode.__panels.push(panel);
      return panel;
    },
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
    workspaceFile: undefined,
    fs: {
      // __files is the whole disk as far as these tests are concerned.
      stat: (uri) => (vscode.__files.has(String(uri.fsPath)) ? Promise.resolve({ type: 1, size: 1 })
        : Promise.reject(new Error('ENOENT'))),
      writeFile: (uri, bytes) => { calls.written.push({ path: String(uri.fsPath), bytes: bytes.length }); return Promise.resolve(); },
    },
    getConfiguration: () => ({ get: (_k, d) => d, inspect: () => undefined, update: () => Promise.resolve() }),
  },
  commands: {
    executeCommand: (id, ...args) => {
      calls.commands.push({ id, args });
      if (id === 'revealFileInOS') calls.revealed.push(String((args[0] && args[0].fsPath) || args[0]));
      return Promise.resolve(undefined);
    },
    registerCommand: () => ({ dispose: () => {} }),
  },
  tasks: { onDidEndTaskProcess: () => ({ dispose: () => {} }) },
  env: {
    shell: process.platform === 'win32' ? 'C:\\Windows\\System32\\cmd.exe' : '/bin/bash',
    clipboard: { writeText: (t) => { calls.written.push({ clipboard: t }); return Promise.resolve(); } },
    openExternal: (uri) => { calls.externals.push(String(uri.fsPath || uri)); return Promise.resolve(true); },
  },
  /** Files the stubbed workspace.fs can see. Tests add paths to it. */
  __files: new Set(),
  /** What showSaveDialog returns; undefined means the user cancelled. */
  __saveTarget: undefined,
  /** Every panel createWebviewPanel has handed out, oldest first. */
  __panels: [],

  /**
   * A WebviewView, as VS Code hands one to a WebviewViewProvider.
   *
   * `badge` is a real writable property because that is exactly what the code under test sets,
   * and `'badge' in view` is how it decides the API exists at all — so a stub that omitted the
   * property would silently make every badge assertion vacuous.
   */
  makeWebviewView() {
    const view = {
      webview: vscode.makeWebview(),
      visible: true,
      badge: undefined,
      __onVisibility: [],
      __onDispose: [],
      onDidChangeVisibility: (fn) => {
        view.__onVisibility.push(fn);
        return { dispose: () => { const i = view.__onVisibility.indexOf(fn); if (i >= 0) view.__onVisibility.splice(i, 1); } };
      },
      onDidDispose: (fn) => {
        view.__onDispose.push(fn);
        return { dispose: () => { const i = view.__onDispose.indexOf(fn); if (i >= 0) view.__onDispose.splice(i, 1); } };
      },
      /** Fire the visibility event to every listener still attached. */
      __setVisible: (v) => { view.visible = v; for (const fn of view.__onVisibility.slice()) fn(); },
      __dispose: () => { for (const fn of view.__onDispose.slice()) fn(); },
      __listenerCount: () => view.__onVisibility.length + view.__onDispose.length,
    };
    return view;
  },
};

vscode.__calls = calls;
vscode.__answers = answers;
vscode.__reset = () => {
  for (const k of Object.keys(calls)) calls[k].length = 0;
  answers.length = 0;
  vscode.__files.clear();
  vscode.__panels.length = 0;
  vscode.__saveTarget = undefined;
  vscode.workspace.isTrusted = true;
  vscode.workspace.workspaceFile = undefined;
  vscode.workspace.workspaceFolders = undefined;
};

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
