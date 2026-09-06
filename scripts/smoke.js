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
 * Exits non-zero if any assertion failed. Registered in package.json as `npm run smoke`.
 *
 * 🔴 THREE THINGS THIS GATE GOT WRONG BEFORE, all of which made it report clean when it was not:
 *
 *   1. It only ever asked whether NAMED FILES WERE PRESENT, from a five-name allowlist, and then
 *      ran every render assertion against the SOURCE tree. A tampered package with 14 runtime
 *      assets deleted — codicons, the Access Map, the walkthrough, the Node reporter — still
 *      printed "28/28 checks passed / Smoke test clean". So did one with all 53 compiled modules
 *      removed and extension.js truncated to zero bytes. The gate carried no evidence at all
 *      about the artefact it had just installed.
 *   2. It could not say what should NOT be in the package. 1.6.1 shipped the developer's own
 *      logs/ folder — the OS username and an internal commit SHA — to a public Marketplace
 *      listing, and passed 28/28.
 *   3. Two of its named assertions passed with the feature they name switched off entirely,
 *      because they matched loose strings against the WHOLE PAGE. See the section-scoping below.
 *
 * The rule those add up to: an assertion must be able to FAIL. If you add one, delete the thing
 * it is meant to catch and watch it go red before you believe it.
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const repo = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const KEEP = args.includes('--keep');
const NO_INSTALL = args.includes('--no-install');

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

// 🔴 Three states, not two. `--no-install` used to make the package-integrity checks quietly
// vanish, and one of them even printed PASS on the strength of the flag alone. A check that did
// not run is reported as SKIP and counted separately, so a green summary can never stand for
// "the package was verified" when nothing looked at the package.
const skipped = [];
const skip = (name, why) => { skipped.push({ name, why }); console.log(`SKIP  ${name}  — ${why}`); };

const existsSafe = (p) => { try { return fs.existsSync(p); } catch { return false; } };

/* ------------------------------------------------------------------ the throwaway profile
 *
 * 🔴 Cleanup hangs off process 'exit', NOT off a `finally`. It used to live in a finally block
 * while both failure paths called process.exit(1) — and process.exit does not run finally. So on
 * exactly the runs where the gate FAILED, which are the runs a developer repeats while fixing
 * things, a 2.2 MB VS Code profile was left in %TEMP% forever and the path was never printed
 * (the only message naming it was on the success path). An 'exit' handler runs for a normal
 * return, for process.exit(), and for an uncaught throw.
 */
let profile = fs.mkdtempSync(path.join(os.tmpdir(), 'spd-smoke-'));
process.on('exit', () => {
  if (!profile) return;
  const at = profile;
  profile = null;
  if (KEEP) { console.log(`profile kept at ${at}`); return; }
  try { fs.rmSync(at, { recursive: true, force: true }); } catch (e) {
    console.error(`could not remove ${at}: ${e.message}`);
  }
});

/** Sweep profiles leaked by older runs of this gate, back when failure skipped cleanup. */
function sweepStaleProfiles() {
  const cutoff = Date.now() - 6 * 3600 * 1000;
  let swept = 0;
  try {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!name.startsWith('spd-smoke-')) continue;
      const p = path.join(os.tmpdir(), name);
      if (p === profile) continue;
      try {
        if (fs.statSync(p).mtimeMs > cutoff) continue;
        fs.rmSync(p, { recursive: true, force: true });
        swept++;
      } catch { /* someone else's, or in use — leave it */ }
    }
  } catch { /* no tmpdir listing; not worth failing the gate over */ }
  if (swept) console.log(`swept ${swept} stale smoke profile(s) from ${os.tmpdir()}`);
}

/* ------------------------------------------------------------------ finding VS Code
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
 * point, stays attached to the console, and exits with a status.
 *
 * 🔴 And on Windows, a `code` on PATH is NOT something to spawn. `where code` returns
 * `<install>\bin\code` first — an extensionless bash shim Windows cannot execute (measured:
 * ENOENT) — and `<install>\bin\code.cmd` second, which Node 20+ refuses to spawn without a shell
 * (measured: EINVAL, CVE-2024-27980). The old fallback took that first line, reported
 * "PASS VS Code CLI found", and then died with an uncaught ENOENT at check 3 of 28: no FAIL
 * line, no cleanup, no readable exit — on every machine whose VS Code is not in one of three
 * hardcoded directories (Insiders, a custom install dir, an enterprise D:\ install, scoop,
 * chocolatey, a portable unzip). A shim is now used only as a POINTER to the install root.
 */
function pathShims() {
  const cmd = process.platform === 'win32' ? 'where' : 'which';
  const found = [];
  for (const name of ['code', 'code-insiders']) {
    let r;
    try { r = spawnSync(cmd, [name], { encoding: 'utf-8', windowsHide: true }); } catch { continue; }
    for (const line of ((r && r.stdout) || '').split(/\r?\n/)) {
      const p = line.trim();
      if (p && existsSafe(p)) found.push(p);
    }
  }
  return found;
}

function windowsRoots() {
  const local = process.env.LOCALAPPDATA || '';
  const pf = process.env.ProgramW6432 || process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const roots = [];
  for (const base of [local && path.join(local, 'Programs'), pf, pf86]) {
    if (!base) continue;
    for (const n of ['Microsoft VS Code', 'Microsoft VS Code Insiders']) roots.push(path.join(base, n));
  }
  // A PATH shim lives at <install>/bin/code, so its grandparent is the install root. Follow it
  // to the root; never spawn the shim itself.
  for (const shim of pathShims()) roots.push(path.resolve(path.dirname(shim), '..'));
  return [...new Set(roots)];
}

function findCode() {
  if (process.platform === 'win32') {
    for (const root of windowsRoots()) {
      const exe = path.join(root, 'Code.exe');
      if (!existsSafe(exe)) continue;
      const cli = findCliJs(root);
      if (cli) return { exe, cli };
    }
    return null;
  }
  // POSIX: the `code` shim really is an executable shell script that runs the CLI and exits.
  const posix = [...pathShims(), '/usr/bin/code', '/usr/local/bin/code', '/snap/bin/code',
    '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'];
  for (const c of posix) if (existsSafe(c)) return { exe: c, cli: null };
  return null;
}

/**
 * cli.js sits under a per-build folder whose name changes with every VS Code update (today
 * `a44adf7f53/resources/app/out/cli.js`), so it has to be found rather than hardcoded — a pinned
 * path would rot at the next update and take this gate down with it.
 */
function findCliJs(root) {
  const direct = path.join(root, 'resources', 'app', 'out', 'cli.js');
  if (existsSafe(direct)) return direct;
  let names = [];
  try { names = fs.readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return null; }
  for (const n of names) {
    const p = path.join(root, n, 'resources', 'app', 'out', 'cli.js');
    if (existsSafe(p)) return p;
  }
  return null;
}

/**
 * Run the VS Code CLI and return what it printed.
 *
 * 🔴 Never throws. This was `if (r.error) throw r.error`, which took the entire gate down with a
 * raw stack trace one line under a green PASS. A CLI that will not run is a FAILED gate, not a
 * crashed one — a crash reports nothing about the other 25 checks.
 */
function runCode(code, argv) {
  const a = code.cli ? [code.cli, ...argv] : argv;
  let r;
  try {
    r = spawnSync(code.exe, a, {
      encoding: 'utf-8',
      timeout: 240000,
      windowsHide: true,
      env: code.cli ? { ...process.env, ELECTRON_RUN_AS_NODE: '1', VSCODE_DEV: '' } : process.env,
    });
  } catch (e) {
    return { ok: false, out: `spawn threw: ${e.message}` };
  }
  if (r.error) return { ok: false, out: `${r.error.code || 'spawn failed'}: ${r.error.message}` };
  return { ok: true, out: `${r.stdout || ''}${r.stderr || ''}` };
}

/* ------------------------------------------------------------------ what the package must hold */

const strip = (p) => String(p).replace(/^\.\//, '');

/**
 * The list of files that must be in the package, derived where possible from the extension's OWN
 * manifest rather than typed out here. A new snippet, schema or walkthrough step is then gated
 * automatically; a hand-maintained allowlist is how a five-name check came to stand in for a
 * whole package.
 */
function requiredFiles(pkg) {
  const c = pkg.contributes || {};
  const need = new Set([
    'package.json', 'out/extension.js',
    'media/dashboard.css', 'media/dashboard.js', 'media/accessMap.js',
    'media/codicons/codicon.css', 'media/codicons/codicon.ttf',
    'media/sections/metrics.css', 'media/sections/timeline.css', 'media/sections/warningTrends.css',
    'python/progress.py', 'reporters/progress.js',
  ]);
  if (pkg.icon) need.add(strip(pkg.icon));
  if (pkg.main) need.add(strip(pkg.main));
  for (const v of (c.viewsContainers && c.viewsContainers.activitybar) || []) if (v.icon) need.add(strip(v.icon));
  for (const s of c.snippets || []) if (s.path) need.add(strip(s.path));
  for (const j of c.jsonValidation || []) if (j.url && !/^https?:/i.test(j.url)) need.add(strip(j.url));
  for (const w of c.walkthroughs || []) {
    for (const s of w.steps || []) {
      for (const k of ['markdown', 'image', 'svg']) {
        const m = s.media && s.media[k];
        if (typeof m === 'string') need.add(strip(m));
      }
    }
  }
  return [...need];
}

/** Read the .vsix itself: every entry, plus any file whose text contains a build-machine needle. */
const VSIX_SCAN = [
  'import json, sys, zipfile',
  'z = zipfile.ZipFile(sys.argv[1])',
  "names = [n for n in z.namelist() if not n.endswith('/')]",
  'needles = [a for a in sys.argv[2:] if a]',
  "TEXT = ('.js', '.json', '.md', '.py', '.css', '.svg', '.txt', '.xml', '.vsixmanifest', '.map', '.ts', '.yml', '.yaml', '.html')",
  '# A PATH is unambiguous and matches as a substring. A bare account name is a word, and',
  '# matching it loosely finds English: the CI account is called "runner", which appears in',
  '# the changelog and in ActionRunner. Word boundaries are the difference between finding an',
  '# identity and finding a noun.',
  'import re',
  'pats = []',
  'for nd in needles:',
  "    looks_like_path = ('/' in nd) or ('\\\\' in nd)",
  '    pats.append((nd, re.compile(re.escape(nd.lower()) if looks_like_path',
  "                                else r'\\b' + re.escape(nd.lower()) + r'\\b')))",
  'leaks = []',
  'for n in names:',
  '    if not n.lower().endswith(TEXT): continue',
  "    try: t = z.read(n).decode('utf-8', 'replace').lower()",
  '    except Exception: continue',
  '    for nd, pat in pats:',
  '        if pat.search(t):',
  "            leaks.append(n + ' :: ' + nd)",
  '            break',
  "print(json.dumps({'names': names, 'leaks': leaks}))",
].join('\n');

function scanVsix(vsix, needles) {
  const r = spawnSync('python', ['-c', VSIX_SCAN, vsix, ...needles], { encoding: 'utf-8', timeout: 120000 });
  if (r.error || r.status !== 0) return { error: (r.error && r.error.message) || (r.stderr || '').trim().slice(0, 200) };
  try { return JSON.parse(r.stdout); } catch (e) { return { error: `unreadable scan output: ${e.message}` }; }
}

function walk(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) stack.push(p); else out.push(p);
    }
  }
  return out;
}

/**
 * Audit the compiled modules inside the INSTALLED package: non-empty, actually parses, and every
 * relative require it makes resolves to a file that shipped. This is what catches the two
 * tampering cases the old gate waved through — 53 modules deleted, and extension.js truncated to
 * zero bytes. It deliberately does not `require()` them: extension.js imports `vscode`, which
 * only exists inside the host, and a stub for it would be one more thing to keep true.
 */
function auditModules(outDir) {
  const files = walk(outDir).filter(f => f.endsWith('.js'));
  const bad = [];
  for (const f of files) {
    const rel = path.relative(outDir, f).replace(/\\/g, '/');
    let src;
    try { src = fs.readFileSync(f, 'utf-8'); } catch (e) { bad.push(`${rel}: unreadable (${e.message})`); continue; }
    if (!src.trim()) { bad.push(`${rel}: empty`); continue; }
    try { new vm.Script(src, { filename: f }); } catch (e) { bad.push(`${rel}: will not parse (${e.message})`); continue; }
    for (const m of src.matchAll(/require\(\s*["'](\.[^"']+)["']\s*\)/g)) {
      const target = path.resolve(path.dirname(f), m[1]);
      if (!existsSafe(target) && !existsSafe(`${target}.js`) && !existsSafe(path.join(target, 'index.js'))) {
        bad.push(`${rel}: requires missing ${m[1]}`);
      }
    }
  }
  return { count: files.length, bad };
}

/* ------------------------------------------------------------------ the gate */

function main() {
  sweepStaleProfiles();
  const ws = path.join(profile, 'ws');
  const logs = path.join(ws, 'logs');
  fs.mkdirSync(path.join(ws, '.vscode'), { recursive: true });
  fs.mkdirSync(logs, { recursive: true });

  // ---------------------------------------------------------------- package + install
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf-8'));
  const vsix = path.join(repo, 'dist', `${pkg.name}-${pkg.version}.vsix`);
  check(`packaged ${path.basename(vsix)} exists`, existsSafe(vsix),
    existsSafe(vsix) ? '' : 'run `npm run package` first');
  if (!existsSafe(vsix)) return;

  // --- what the artefact must NOT contain. Runs in both modes: it reads the .vsix directly, so
  // --- --no-install still gets the leak gate.
  let me = '';
  try { me = os.userInfo().username || ''; } catch { /* unknown user; skip that needle */ }
  // A shared build account tells nobody anything, and its name is usually an ordinary word —
  // GitHub's is literally `runner`. The home PATH is still checked on those machines, and it is
  // the half that would actually expose someone.
  const SHARED = ['runner', 'runneradmin', 'root', 'user', 'build', 'builder', 'vsts', 'admin',
    'administrator', 'jenkins', 'circleci', 'travis', 'azureuser', 'ubuntu', 'vagrant'];
  const personal = me.length >= 4 && !SHARED.includes(me.toLowerCase()) ? me : '';
  const needles = [personal, os.homedir()].filter(Boolean);
  const scan = scanVsix(vsix, needles);
  if (scan.error) {
    check('.vsix contents readable', false, scan.error);
  } else {
    const stray = scan.names.filter(n => /^extension\/(logs|\.git|\.github|node_modules|src|test|dist|\.backups|\.harness|__pycache__)\//.test(n));
    check('no developer-only folders in the package', !stray.length,
      stray.length ? `${stray.length}: ${stray.slice(0, 4).join(', ')}` : `${scan.names.length} entries`);
    check('package carries no build-machine identity', !scan.leaks.length,
      scan.leaks.length ? scan.leaks.slice(0, 3).join(' | ') : `checked ${needles.join(', ') || '(none)'}`);
  }

  let reporterInPackage = path.join(repo, 'python', 'progress.py');
  let installed = null;
  if (NO_INSTALL) {
    for (const n of ['extension installs into a clean profile', 'reporter ships inside the package',
      'every file the manifest declares is in the package', 'packaged modules are complete and parse',
      'render assertions run against the PACKAGED code']) skip(n, '--no-install');
  } else {
    const code = findCode();
    check('VS Code CLI found', !!code, code ? (code.cli || code.exe) : 'no Code.exe with a cli.js in %LOCALAPPDATA%\\Programs, %ProgramFiles%, or beside a `code` on PATH');
    if (code) {
      const r = runCode(code, [
        '--user-data-dir', path.join(profile, 'data'),
        '--extensions-dir', path.join(profile, 'ext'),
        '--install-extension', vsix, '--force',
      ]);
      check('extension installs into a clean profile', r.ok && /successfully installed/i.test(r.out),
        r.out.trim().split('\n').pop());
      const dir = path.join(profile, 'ext', `${pkg.publisher}.${pkg.name}-${pkg.version}`);
      check('install folder present', existsSafe(dir), dir);
      if (existsSafe(dir)) {
        installed = dir;
        // The reporter people are told to copy is the one INSIDE the package, not the source tree.
        const packed = path.join(dir, 'python', 'progress.py');
        check('reporter ships inside the package', existsSafe(packed));
        if (existsSafe(packed)) {
          reporterInPackage = packed;
          const a = fs.readFileSync(packed, 'utf-8'), b = fs.readFileSync(path.join(repo, 'python', 'progress.py'), 'utf-8');
          check('packaged reporter matches the source', a === b);
        }
        const missing = requiredFiles(JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')))
          .filter(f => !existsSafe(path.join(dir, f)));
        check('every file the manifest declares is in the package', !missing.length,
          missing.length ? missing.join(', ') : `${requiredFiles(pkg).length} checked`);

        const mods = auditModules(path.join(dir, 'out'));
        check('packaged modules are complete and parse', mods.count > 40 && !mods.bad.length,
          mods.bad.length ? `${mods.bad.length} bad: ${mods.bad.slice(0, 3).join(' | ')}` : `${mods.count} modules`);
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
    check(`wrote ${f}`, existsSafe(path.join(logs, f)));
  }

  // ---------------------------------------------------------------- render it for real
  //
  // 🔴 From the INSTALLED tree, not the source tree. Rendering the repo's own out/ told you
  // nothing whatsoever about the package this gate had just installed — which is how a package
  // with every compiled module deleted still passed the eleven assertions below.
  const outDir = installed ? path.join(installed, 'out') : path.join(repo, 'out');
  if (installed) check('render assertions run against the PACKAGED code', true, outDir);
  else if (!NO_INSTALL) check('render assertions run against the PACKAGED code', false,
    'the package was NOT verified — falling back to the source tree');
  let DataReader, renderSections;
  try {
    ({ DataReader } = require(path.join(outDir, 'dataReader.js')));
    ({ renderSections } = require(path.join(outDir, 'render/dashboard.js')));
  } catch (e) {
    check('the packaged renderers load', false, `${outDir}: ${e.message.split('\n')[0]}`);
    return;
  }
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

  /**
   * 🔴 Scope every assertion to the section that owns it.
   *
   * Two checks here used to match loose strings against the whole page, and both passed with the
   * feature they name switched off entirely: "missing an owner flag" is also printed by the
   * Warnings card, so the Pending Actions check passed with Pending Actions gone; and "not
   * needed" only ever appears on a DISABLED button, so asserting its ABSENCE passed when Quick
   * Actions rendered no buttons at all — or was not on the page.
   */
  const sections = new Map();
  for (const part of html.split(/(?=<section\b)/)) {
    const m = part.match(/^<section[^>]*data-section="([^"]+)"/);
    if (m) sections.set(m[1], part);
  }
  const sectionText = (id) => (sections.get(id) || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  for (const id of ['pendingActions', 'quickActions', 'impact', 'deltaTracker', 'processCalendar', 'runHistory']) {
    check(`section on the page: ${id}`, sections.has(id));
  }

  check('three runs recorded', data.history.length === 3, `got ${data.history.length}`);

  const pa = sectionText('pendingActions');
  check('the actionable finding is in Pending Actions',
    /missing an owner flag/.test(pa) && !/Nothing is marked as needing action/.test(pa),
    pa.slice(0, 110) || 'section absent');

  check('the crash was categorised', data.history.some(r => r.category === 'KeyError'));
  check('impact total shown', /1,204\.5/.test(sectionText('impact')));
  check('delta pair shown', /found .* resolved to/.test(sectionText('deltaTracker')));
  check('downstream is blocked', /waiting on Upstream Extract/.test(sectionText('processCalendar')));
  check('phased process is partial', /1 of 2 phases/.test(sectionText('processCalendar')));

  const buttons = (sections.get('quickActions') || '').match(/<button\b[\s\S]*?<\/button>/g) || [];
  const fix = buttons.filter(b => />\s*Fix\s*</.test(b));
  const labels = buttons.map(b => (b.match(/<span>([^<]*)<\/span>/) || [, '?'])[1]);
  check('Quick Actions renders the configured Fix button', fix.length === 1,
    `${buttons.length} button(s): ${labels.join(', ') || 'none'}`);
  check('the Fix button is ENABLED while issues > 0', fix.length === 1 && !/\sdisabled/.test(fix[0]),
    fix.length ? fix[0].slice(0, 120) : 'no Fix button to judge');

  check('run attributed', data.history.some(r => r.user));
  check('no NaN or undefined on the page', !/\bNaN\b|\bundefined\b/.test(text));
  check('renders for the sidebar too',
    typeof renderSections(data, settings, { now: new Date(), surface: 'sidebar', trusted: true, collapsed: [] }) === 'string');
}

try {
  main();
} catch (e) {
  check('gate ran to completion', false, (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : String(e)));
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`
  + (skipped.length ? `, ${skipped.length} SKIPPED` : ''));
if (skipped.length) {
  console.log(`\nNOT VERIFIED by this run:\n${skipped.map(s => `  - ${s.name} (${s.why})`).join('\n')}`);
}
if (failed.length) {
  console.error(`\nFAILED:\n${failed.map(f => `  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`).join('\n')}`);
  if (!KEEP) console.error('\nRe-run with --keep to hold the profile open for inspection.');
  process.exitCode = 1;
} else {
  console.log('Smoke test clean.');
}
