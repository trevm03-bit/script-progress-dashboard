#!/usr/bin/env node
/**
 * Release gate: install the packaged .vsix into a THROWAWAY VS Code profile, run real scripts
 * against the reporter that ships inside it, and assert on what the real renderers produce.
 *
 * Why this exists: a live check in VS Code was done once, at 1.1.0, and then not repeated for
 * four releases — which is worse than never having done it, because the release notes look
 * covered. Unit tests and the browser harness both run against the SOURCE tree; neither can tell
 * you that the packaged extension installs, that the reporter inside the package is the one you
 * think it is, or that a real settings.json drives the features you just shipped.
 *
 *   node scripts/smoke.js                 build, package, install, run, assert
 *   node scripts/smoke.js --keep          leave the profile behind for inspection
 *   node scripts/smoke.js --no-install    skip VS Code (assert on the reporter + renderers only)
 *
 * Exits non-zero on the first failed assertion. Registered in package.json as `npm run smoke`.
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const KEEP = args.includes('--keep');
const NO_INSTALL = args.includes('--no-install');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

/**
 * Where VS Code is, and HOW to drive its command line.
 *
 * 🔴 `Code.exe --install-extension` does not work. Code.exe is the GUI binary: on Windows it
 * hands the arguments to a detached window and never writes to stdout, so spawnSync sits there
 * until it times out — which is exactly what this gate did, silently, instead of checking
 * anything. The bundled `bin\code.cmd` reveals the real contract:
 *
 *     set ELECTRON_RUN_AS_NODE=1
 *     Code.exe <install>\resources\app\out\cli.js %*
 *
 * With that environment variable the same executable runs as plain Node against the CLI entry
 * point, stays attached to the console, and exits with a status. Driving it that way also avoids
 * going through a .cmd, which Node 20+ refuses to spawn without a shell (CVE-2024-27980) — and a
 * shell would mean quoting every path, in a repo whose folder has a space in it.
 */
function findCode() {
  const local = process.env.LOCALAPPDATA || '';
  const roots = [
    path.join(local, 'Programs', 'Microsoft VS Code'),
    'C:\\Program Files\\Microsoft VS Code',
    'C:\\Program Files (x86)\\Microsoft VS Code',
  ];
  for (const root of roots) {
    const exe = path.join(root, 'Code.exe');
    try { if (!fs.existsSync(exe)) continue; } catch { continue; }
    const cli = findCliJs(root);
    if (cli) return { exe, cli };
  }
  // POSIX: the `code` shim is a shell script that already runs the CLI and exits.
  const posix = ['/usr/bin/code', '/usr/local/bin/code', '/snap/bin/code',
    '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'];
  for (const c of posix) { try { if (fs.existsSync(c)) return { exe: c, cli: null }; } catch { /* keep looking */ } }
  const which = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['code'], { encoding: 'utf-8' });
  const first = (which.stdout || '').split(/\r?\n/).find(Boolean);
  return first && fs.existsSync(first.trim()) ? { exe: first.trim(), cli: null } : null;
}

/**
 * cli.js sits under a per-build folder whose name changes with every VS Code update (today
 * `a44adf7f53/resources/app/out/cli.js`), so it has to be found rather than hardcoded — a pinned
 * path would rot at the next update and take this gate down with it.
 */
function findCliJs(root) {
  const direct = path.join(root, 'resources', 'app', 'out', 'cli.js');
  try { if (fs.existsSync(direct)) return direct; } catch { /* keep looking */ }
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return null; }
  for (const n of names) {
    const p = path.join(root, n, 'resources', 'app', 'out', 'cli.js');
    try { if (fs.existsSync(p)) return p; } catch { /* keep looking */ }
  }
  return null;
}

/** Run the VS Code CLI and return everything it printed. */
function runCode(code, argv) {
  const args = code.cli ? [code.cli, ...argv] : argv;
  const r = spawnSync(code.exe, args, {
    encoding: 'utf-8',
    timeout: 240000,
    windowsHide: true,
    env: code.cli ? { ...process.env, ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' } : process.env,
  });
  if (r.error) throw r.error;
  return `${r.stdout || ''}${r.stderr || ''}`;
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spd-smoke-'));
const ws = path.join(root, 'ws');
const logs = path.join(ws, 'logs');
fs.mkdirSync(path.join(ws, '.vscode'), { recursive: true });
fs.mkdirSync(logs, { recursive: true });

try {
  // ---------------------------------------------------------------- package + install
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf-8'));
  const vsix = path.join(repo, 'dist', `${pkg.name}-${pkg.version}.vsix`);
  check(`packaged ${path.basename(vsix)} exists`, fs.existsSync(vsix),
    fs.existsSync(vsix) ? '' : 'run `npm run package` first');
  if (!fs.existsSync(vsix)) process.exit(1);

  let reporterInPackage = path.join(repo, 'python', 'progress.py');
  if (!NO_INSTALL) {
    const code = findCode();
    check('VS Code CLI found', !!code, code ? (code.cli || code.exe) : 'set PATH or install VS Code');
    if (code) {
      const out = runCode(code, [
        '--user-data-dir', path.join(root, 'data'),
        '--extensions-dir', path.join(root, 'ext'),
        '--install-extension', vsix, '--force',
      ]);
      check('extension installs into a clean profile', /successfully installed/i.test(out), out.trim().split('\n').pop());
      const installed = path.join(root, 'ext', `${pkg.publisher}.${pkg.name}-${pkg.version}`);
      check('install folder present', fs.existsSync(installed), installed);
      // The reporter people are told to copy is the one INSIDE the package, not the source tree.
      const packed = path.join(installed, 'python', 'progress.py');
      check('reporter ships inside the package', fs.existsSync(packed));
      if (fs.existsSync(packed)) {
        reporterInPackage = packed;
        const a = fs.readFileSync(packed, 'utf-8'), b = fs.readFileSync(path.join(repo, 'python', 'progress.py'), 'utf-8');
        check('packaged reporter matches the source', a === b);
      }
      for (const need of ['out/extension.js', 'media/dashboard.css', 'media/dashboard.js', 'schemas', 'snippets']) {
        check(`packaged: ${need}`, fs.existsSync(path.join(installed, need)));
      }
    }
  }

  // ---------------------------------------------------------------- a real workspace
  fs.writeFileSync(path.join(ws, '.vscode', 'settings.json'), JSON.stringify({
    'scriptProgress.logsPath': 'logs',
    'scriptProgress.sections.impact': true,
    'scriptProgress.sections.deltaTracker': true,
    'scriptProgress.sections.quickActions': true,
    'scriptProgress.processCalendar.processes': [
      { name: 'Nightly Load', label: 'Nightly', frequency: 'daily', reminderDays: 1 },
      { name: 'Close', label: 'Close', frequency: 'monthly', dayOfMonth: 5, subtasks: ['Close Phase 1', 'Close Phase 2'] },
      // Downstream depends on a process that is configured but has NOT run, so "blocked" is
      // actually reachable. Pointing it at Nightly Load asserted nothing: that one succeeds
      // earlier in this very script, so its dependency is satisfied and the row is never blocked.
      { name: 'Upstream Extract', label: 'Upstream', frequency: 'daily' },
      { name: 'Downstream', label: 'Downstream', frequency: 'daily', dependsOn: ['Upstream Extract'] },
    ],
    'scriptProgress.quickActions.buttons': [
      { label: 'Fix', command: 'python fix.py', task: 'Nightly Load', enableWhen: { metric: 'issues', gt: 0 } },
    ],
    'scriptProgress.deltaTracker.thresholds': { drift: { min: -5, max: 5, target: 0 } },
  }, null, 2), 'utf-8');

  // ---------------------------------------------------------------- run real scripts
  fs.copyFileSync(reporterInPackage, path.join(ws, 'progress.py'));
  fs.writeFileSync(path.join(ws, 'run.py'), `
import sys; sys.path.insert(0, r"${ws.replace(/\\/g, '\\\\')}")
from progress import Progress
with Progress("Nightly Load") as p:
    p.step(1, 3, "Extract"); p.access("table", "sales.orders", "read")
    p.metric("issues", 3)
    p.warn("2 records missing an owner flag", count=2, category="missing-flag", actionable=True)
    p.warn("Section 6 discontinuities", count=310, category="cross-quarter", severity="info")
    p.step(2, 3, "Reconcile"); p.track_delta("drift", 26.5)
    p.impact("corrections_found", 1204.50, label="Corrections identified")
    p.step(3, 3, "Fix"); p.track_delta("drift", 0.0)
    p.complete(summary="3 issues, 2 need attention")
with Progress("Close Phase 1") as p:
    p.step(1, 1, "Phase 1"); p.complete(summary="phase 1 done")
try:
    with Progress("Broken Job") as p:
        p.step(1, 2, "Working"); raise KeyError("boom")
except KeyError: pass
`, 'utf-8');
  const py = spawnSync('python', [path.join(ws, 'run.py')], {
    encoding: 'utf-8', cwd: ws, env: { ...process.env, PROGRESS_LOGS_DIR: logs }, timeout: 120000,
  });
  check('scripts ran against the packaged reporter', py.status === 0, (py.stderr || '').trim().slice(0, 160));
  for (const f of ['progress.json', 'run_history.json', 'deltas.json', 'impact.json', 'access.json']) {
    check(`wrote ${f}`, fs.existsSync(path.join(logs, f)));
  }

  // ---------------------------------------------------------------- render it for real
  const { DataReader } = require(path.join(repo, 'out/dataReader.js'));
  const { renderSections } = require(path.join(repo, 'out/render/dashboard.js'));
  const { settings: S } = require(path.join(repo, 'test/fixtures/settings.js'));
  const cfg = JSON.parse(fs.readFileSync(path.join(ws, '.vscode', 'settings.json'), 'utf-8'));
  const data = new DataReader(logs).readAll();
  const settings = S({
    processes: cfg['scriptProgress.processCalendar.processes'],
    buttons: cfg['scriptProgress.quickActions.buttons'],
    deltaMetrics: ['drift'],
    deltas: { formats: {}, thresholds: cfg['scriptProgress.deltaTracker.thresholds'], points: 50 },
  });
  const html = renderSections(data, settings, { now: new Date(), surface: 'panel', trusted: true, collapsed: [] });
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  check('three runs recorded', data.history.length === 3, `got ${data.history.length}`);
  check('actionable finding is pending', /missing an owner flag/.test(text));
  check('the crash was categorised', data.history.some(r => r.category === 'KeyError'));
  check('impact total shown', /1,204\.5/.test(text));
  check('delta pair shown', /found .* resolved to/.test(text));
  check('downstream is blocked', /waiting on Upstream Extract/.test(text));
  check('phased process is partial', /1 of 2 phases/.test(text));
  check('button enabled while issues > 0', !/not needed/.test(text));
  check('run attributed', data.history.some(r => r.user));
  check('no NaN or undefined on the page', !/\bNaN\b|\bundefined\b/.test(text));
  check('renders for the sidebar too',
    typeof renderSections(data, settings, { now: new Date(), surface: 'sidebar', trusted: true, collapsed: [] }) === 'string');

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length) {
    console.error(`\nFAILED:\n${failed.map(f => `  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`).join('\n')}`);
    process.exit(1);
  }
  console.log('Smoke test clean.');
} finally {
  if (KEEP) console.log(`profile kept at ${root}`);
  else fs.rmSync(root, { recursive: true, force: true });
}
