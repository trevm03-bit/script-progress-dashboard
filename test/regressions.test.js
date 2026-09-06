// Regression tests for defects found by the 1.6.0 adversarial review.
//
// Every one of these failed before 1.6.0. They live here rather than in a scratch file because
// the reviews that found them were expensive, and a defect nobody has a test for is a defect
// that comes back. Each block names the symptom a user would have seen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const repo = path.resolve(__dirname, '..');

const { renderSections } = require(path.join(repo, 'out/render/dashboard.js'));
const { reportHtml, mapSvg } = require(path.join(repo, 'out/logic/report.js'));
const { formatDuration, exitOverlayFor, sameTask } = require(path.join(repo, 'out/logic/time.js'));
const { historyCsv, weeklyDigestText, summaryFacts } = require(path.join(repo, 'out/logic/summary.js'));
const { coverage } = require(path.join(repo, 'out/logic/compliance.js'));
const { healthRows } = require(path.join(repo, 'out/logic/health.js'));
const { durationVerdicts, durationVerdict } = require(path.join(repo, 'out/logic/anomaly.js'));
const { validateSettings } = require(path.join(repo, 'out/logic/validate.js'));
const { matchesProcess, normaliseProcesses, unmetDependencies, unresolvableDependencies, processStatus } = require(path.join(repo, 'out/logic/calendar.js'));
const { commandForFile, shellHazard, shellKindFor } = require(path.join(repo, 'out/logic/shell.js'));
const { runbookMarkdown } = require(path.join(repo, 'out/logic/runbook.js'));
const { settings: S } = require(path.join(repo, 'test/fixtures/settings.js'));

/** Each check becomes its own named test, so a failure says what broke in words. */
const check = (name, cond, detail = undefined) => test(name, () => assert.ok(cond, detail === undefined ? undefined : String(detail)));
const NOW = new Date(2026, 8, 2, 10, 0, 30);
const base = { progress: null, tasks: [], history: [], deltas: {}, impact: {}, access: null, overlays: [], logsDir: 'x', logsDirExists: true, readErrors: [] };
const render = (d, s, extra = {}) => renderSections(d, s, { now: NOW, surface: 'panel', trusted: true, collapsed: [], ...extra });

// 1 — durations that cannot exist
check('formatDuration carries', ['1m', '1m', '2m', '3m', '1h'].join() ===
  [59.5, 59.6, 119.6, 179.7, 3599.6].map(formatDuration).join(), [59.5, 119.6, 3599.6].map(formatDuration).join());

// 2 — report survives an unknown access node type
for (const t of ['queue', 'Table', '']) {
  const d = { ...base, access: { nodes: [{ id: `${t}:x`, type: t, label: 'x', degree: 1 }, { id: 'task:T', type: 'task', label: 'T', degree: 1 }], edges: [] } };
  const s = S({}); s.sections = { ...s.sections, accessMap: true };
  let ok = true; try { mapSvg(d, s, NOW); reportHtml(d, s, NOW); } catch (e) { ok = false; var why = e.message; }
  check(`report survives access node type ${JSON.stringify(t)}`, ok, why || '');
}

// 3 — calendar frequency colliding with Object.prototype
for (const freq of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'quarterly']) {
  const s = S({ processes: [{ name: 'X', label: 'X', frequency: freq }] });
  s.sections = { ...s.sections, processCalendar: true };
  let ok = true; try { render(base, s); } catch (e) { ok = false; var why2 = e.message; }
  check(`calendar survives frequency ${JSON.stringify(freq)}`, ok, why2 || '');
}

// 4 — CSV header quoting
const csvHead = historyCsv([{ date: '2026-09-02T09:00:00', task: 'T', success: true, elapsed: 1, warnings: 0, summary: 'x', metrics: { 'rows,loaded': 5, 'a"b': 2 } }]).split(/\r?\n/)[0];
check('CSV header is quoted', csvHead.endsWith('"a""b","rows,loaded"'), csvHead);

// 5 — same-second tie-break agrees across sections
const tie = [
  { task: 'N', date: '2026-09-02T09:00:00', success: true, elapsed: 10, warnings: 0, summary: 'FIRST' },
  { task: 'N', date: '2026-09-02T09:00:00', success: true, elapsed: 20, warnings: 0, summary: 'SECOND' },
];
check('health picks the later of two same-second runs', healthRows(tie, 24, NOW, 0)[0].last.summary === 'SECOND',
  healthRows(tie, 24, NOW, 0)[0].last.summary);

// 6 — bounded windows
const future = [
  { task: 'A', date: '2026-09-03T09:00:00', success: true, elapsed: 10, warnings: 0, summary: 'ok' },
  { task: 'A', date: '2035-01-01T09:00:00', success: false, elapsed: 10, warnings: 5, summary: 'FOUR MONTHS LATER', category: 'auth' },
];
const dig = weeklyDigestText({ ...base, history: future }, S({}), new Date(2026, 8, 4, 14, 30));
check('digest excludes future-dated runs', !dig.includes('FOUR MONTHS LATER'), dig.split('\n').slice(0, 3).join(' | '));
const cov = coverage([], future, 0, 0, new Date(2026, 8, 4), 30, { schedule: 2, success: 2, metrics: 1 }, 100);
check('coverage excludes future-dated runs', /1\/1 run/.test(JSON.stringify(cov.inputs)), JSON.stringify(cov.inputs.map(i => i.detail)));

// 7 — all-zero weights say why
const s0 = S({}); s0.coverage = { show: true, weights: { schedule: 0, success: 0, metrics: 0 } };
s0.processes = [{ name: 'P', label: 'P', frequency: 'daily' }];
const h0 = render({ ...base, history: [{ task: 'P', date: '2026-09-02T09:00:00', success: true, elapsed: 1, warnings: 0, summary: '' }] }, s0);
check('all-zero coverage weights are explained on the page', /every weight is 0/.test(h0));

// 8 — dependsOn: the typo guard, and the false positive it used to come with
//
// 🔴 dependsOn lists TASK-name prefixes resolved against RUN HISTORY - README, types.ts and
// unmetDependencies all say so. validateSettings was checking them against configured PROCESS
// names, so depending on any real reported task the user did not also want a calendar row for was
// reported as broken, with the panel printing "will stay blocked for ever" directly above a row
// that was working. The shipped demo config was itself an instance. The guard now lives in
// calendar.ts, where the history that can actually answer the question is in scope.
const ranUpstream = [{ task: 'Upstream Extract', date: '2026-09-02T08:00:00', success: true, elapsed: 1, warnings: 0, summary: '' }];
const dependent = { name: 'Daily Load', label: 'Daily', frequency: 'daily', dependsOn: ['Upstream Extract'] };
check('a dependsOn on a real task that is not a configured process is NOT reported',
  validateSettings({ processes: [dependent] }).length === 0,
  JSON.stringify(validateSettings({ processes: [dependent] })));
check('a dependsOn naming nothing that ever ran is caught where the history is',
  unresolvableDependencies({ ...dependent, dependsOn: ['Upstrem Extract'] }, ranUpstream).length === 1);
check('a dependsOn that a real task satisfies is not flagged',
  unresolvableDependencies(dependent, ranUpstream).length === 0);
check('with no history at all, nothing is judged',
  unresolvableDependencies({ ...dependent, dependsOn: ['Upstrem Extract'] }, []).length === 0);
check('the typo reaches the user in the row note',
  /has ever run/.test(processStatus({ ...dependent, dependsOn: ['Upstrem Extract'] }, ranUpstream, NOW).note || ''),
  processStatus({ ...dependent, dependsOn: ['Upstrem Extract'] }, ranUpstream, NOW).note);
check('self-dependency is still a settings error settings alone can prove',
  validateSettings({ processes: [{ name: 'A', frequency: 'daily', dependsOn: ['A'] }] })
    .some(x => /depends on itself/.test(x.message)));

// 🔴 One normalisation point. validate() trims every field before judging it and the consumers
// used the raw value, so all three of these validated clean and then misbehaved silently.
check('a name with stray whitespace still matches its runs',
  matchesProcess('Revenue Load Nightly', { name: ' Revenue Load', frequency: 'daily' }));
check('a non-string name cannot throw out of the render',
  matchesProcess('anything', { name: 5, frequency: 'daily' }) === false);
check('normaliseProcesses trims name, frequency, dependsOn and subtasks',
  JSON.stringify(normaliseProcesses([{ name: ' Revenue Load ', frequency: ' daily ', dependsOn: [' Extract '], subtasks: [' Phase 1 '] }]))
  === JSON.stringify([{ name: 'Revenue Load', frequency: 'daily', dependsOn: ['Extract'], subtasks: ['Phase 1'] }]),
  JSON.stringify(normaliseProcesses([{ name: ' Revenue Load ', frequency: ' daily ', dependsOn: [' Extract '], subtasks: [' Phase 1 '] }])));
check('normaliseProcesses drops an entry whose name cannot be used',
  normaliseProcesses([{ name: 5 }, { name: '  ' }, null, 'x', { name: 'Good', frequency: 'daily' }]).length === 1);
check('a trimmed dependsOn resolves against a real run',
  unmetDependencies({ name: 'D', frequency: 'daily', dependsOn: [' Upstream Extract '] }, ranUpstream, NOW).length === 0);

// dayOfWeek is ISO 1-7 everywhere else in the product; validate alone said 0-6, and the correction
// it printed was acted on - 0 validates clean and dueDate clamps it to Monday, six days early.
check('dayOfWeek 7 (Sunday) validates', validateSettings({ processes: [{ name: 'W', frequency: 'weekly', dayOfWeek: 7 }] }).length === 0);
check('dayOfWeek 0 is now reported', validateSettings({ processes: [{ name: 'W', frequency: 'weekly', dayOfWeek: 0 }] }).some(x => /dayOfWeek/.test(x.message)));

// An empty deltaTracker.metrics means EVERY metric, which is how the setting ships and what the
// renderer implements - so the documented default way to use a threshold raised a false problem
// per threshold, printed above the chart that was drawing it.
check('a threshold with the default empty metrics list is not reported',
  validateSettings({ deltaMetrics: [], deltaThresholds: { net_delta: { min: -5, max: 5 } } }).length === 0,
  JSON.stringify(validateSettings({ deltaMetrics: [], deltaThresholds: { net_delta: { min: -5, max: 5 } } })));
check('a threshold outside a NON-empty metrics list is still reported',
  validateSettings({ deltaMetrics: ['other'], deltaThresholds: { net_delta: { min: -5, max: 5 } } })
    .some(x => /never charted/.test(x.message)));
const self = validateSettings({ processes: [{ name: 'A', label: 'A', frequency: 'daily', dependsOn: ['A'] }] });
check('a self-referential dependsOn is reported', self.some(p => /depends on itself/.test(p.message || String(p))), JSON.stringify(self));

// 9 — identity gating
const idData = { ...base, history: [{ task: 'T', date: '2026-09-02T09:00:00', success: true, elapsed: 5, warnings: 0, summary: 's', user: 'TTM03', commit: 'a1b2c3d' }] };
for (const inc of [true, false]) {
  const s = S({}); s.report = { ...(s.report || {}), includeIdentity: inc };
  const h = reportHtml(idData, s, NOW);
  check(`report identity present=${inc}`, h.includes('TTM03') === inc && h.includes('a1b2c3d') === inc);
}
check('the live dashboard always shows identity', render(idData, S({})).includes('TTM03'));

// 10 — no dead message buttons survive into the report
const rep = reportHtml({ ...base, history: idData.history }, S({}), NOW);
check('report strips every data-msg button', !/data-msg=/.test(rep), (rep.match(/<button[^>]*data-msg="[^"]*"/g) || []).slice(0, 1));

// 11 — exit overlays are exact and newest-wins
const prog = { task: 'Nightly Load', status: 'running', updatedAt: '2026-09-02T10:00:20', elapsed: 20, step: 1, totalSteps: 2, label: 'x', detail: '', warnings: [], metrics: {}, log: [], artifacts: [], accessed: [] };
check('a prefix overlay no longer attaches', exitOverlayFor(prog, [{ task: 'Nightly', exitCode: 1, when: '2026-09-02T10:00:25' }]) === null);
check('an exact overlay attaches', !!exitOverlayFor(prog, [{ task: 'NIGHTLY LOAD', exitCode: 1, when: '2026-09-02T10:00:25' }]));
check('sameTask is whole-name', sameTask('Nightly Load', 'NIGHTLY load') && !sameTask('Nightly Load', 'Nightly'));

// 12 — bulk verdicts match the single-run function
const many = [];
for (let i = 0; i < 60; i++) many.push({ task: i % 3 ? 'A' : 'B', date: `2026-08-${String((i % 28) + 1).padStart(2, '0')}T09:00:00`, success: i % 7 !== 0, elapsed: 10 + (i % 5), warnings: 0, summary: '' });
const bulk = durationVerdicts(many, 2);
let mismatch = 0;
for (const r of many) {
  const a = bulk.get(r), b = durationVerdict(r, many, 2);
  if (a.slow !== b.slow || Math.abs(a.baseline - b.baseline) > 1e-9 || a.sample !== b.sample) mismatch++;
}
check('durationVerdicts matches durationVerdict for every run', mismatch === 0, `${mismatch} differ`);

// 13 — the O(n^2) render is gone
//
// 🔴 This used to be `ms < 200` against the wall clock, and it made CI red from 1.6.1 onward:
// the GitHub runner took 249ms for work this machine does in well under 200, so the suite failed
// for being on slower hardware. A correctness gate that goes red on machine speed is worse than
// no gate — it teaches everyone to ignore the red, which is exactly what happened here.
//
// What the test actually cares about is COMPLEXITY, and that is machine-independent. Quadruple
// the input: a linear render takes ~4x as long, the quadratic one it replaced took ~16x (5,000
// runs went from 1396ms to 45ms, so 1,250 would have been ~87ms). A ratio below 8 sits squarely
// between the two on any hardware. The absolute ceiling below is only a catastrophe stop.
const historyOfSize = (n) => {
  const out = [];
  for (let i = 0; i < n; i++) out.push({ task: `T${i % 8}`, date: new Date(2026, 7, 1 + (i % 28), 9, i % 60).toISOString().slice(0, 19), success: i % 11 !== 0, elapsed: 10 + (i % 30), warnings: i % 3, summary: 's' });
  return out;
};
const sBig = S({}); sBig.runHistory = { ...sBig.runHistory, anomalies: true, filters: true };
const timeRender = (n) => {
  const h = historyOfSize(n);
  const runs = [];
  for (let i = 0; i < 3; i++) {
    const t0 = performance.now();
    render({ ...base, history: h }, sBig);
    runs.push(performance.now() - t0);
  }
  return runs.sort((a, b) => a - b)[1];   // median of 3, so one scheduling hiccup cannot decide it
};
render({ ...base, history: historyOfSize(200) }, sBig);   // warm the JIT before either measurement
const small = timeRender(1250);
const large = timeRender(5000);
const ratio = large / Math.max(small, 0.05);
check('4x the runs costs ~4x the time, not ~16x (the O(n^2) render stays gone)', ratio < 8,
  `1250 runs ${small.toFixed(1)}ms -> 5000 runs ${large.toFixed(1)}ms = ${ratio.toFixed(1)}x`);
check('5,000 runs render without stalling (was 1396ms)', large < 3000, `${large.toFixed(0)}ms`);
const big = historyOfSize(5000);

// 14 — uncapped lists
const warns = []; for (let i = 0; i < 500; i++) warns.push({ time: '2026-09-02T09:00:00', msg: `account ${i} unmatched`, actionable: true });
const wData = { ...base, progress: { ...prog, warnings: warns }, tasks: [{ ...prog, warnings: warns }] };
const wHtml = render(wData, S({}));
check('500 warnings do not render 500 cards', (wHtml.match(/class="warning-card"/g) || []).length <= 40,
  (wHtml.match(/class="warning-card"/g) || []).length);

// 15 — a rendered page never leaks NaN/undefined
check('no NaN or undefined in a full render', !/\bNaN\b|\bundefined\b/.test(render({ ...base, history: big.slice(0, 40) }, S({})).replace(/<[^>]+>/g, ' ')));

// 16 — idle renders are stable within a minute
const idle = { ...base, history: big.slice(0, 30) };
check('idle render is stable across 40 seconds',
  renderSections(idle, S({}), { now: new Date(2026, 8, 2, 10, 0, 5), surface: 'panel', trusted: true, collapsed: [] }) ===
  renderSections(idle, S({}), { now: new Date(2026, 8, 2, 10, 0, 45), surface: 'panel', trusted: true, collapsed: [] }));

// 17 — cross-platform command building
check('posix python default becomes python3', commandForFile('/x/run.py', { '.py': 'python' }, 'linux') === 'python3 /x/run.py',
  commandForFile('/x/run.py', { '.py': 'python' }, 'linux'));
check('windows python default is untouched', commandForFile('C:\\x\\run.py', { '.py': 'python' }, 'win32') === 'python C:\\x\\run.py');
check('posix quotes a shell metacharacter', commandForFile('/x/report(v2).py', { '.py': 'python' }, 'darwin') === "python3 '/x/report(v2).py'",
  commandForFile('/x/report(v2).py', { '.py': 'python' }, 'darwin'));
check('posix neutralises command substitution', commandForFile('/x/run$(id).py', { '.py': 'python' }, 'linux') === "python3 '/x/run$(id).py'",
  commandForFile('/x/run$(id).py', { '.py': 'python' }, 'linux'));

// 17b — 🔴 "Windows" is not a shell. The old win32 branch wrapped the path in DOUBLE quotes, which
// PowerShell (VS Code's default profile on Windows) treats as expandable: $(...), $var and the
// backtick are all live inside them. Verified against a real PowerShell before this was written:
// "Run with Script Progress" on a file called `$(ni PWNED.txt).py` created PWNED.txt and never ran
// the script. Single quotes are the only PowerShell string that is literal all the way through.
const ps = (f, i = { '.py': 'python' }) => commandForFile(f, i, { shell: 'powershell', platform: 'win32' });
for (const [label, name] of [
  ['a subexpression', 'C:\\s\\$(ni PWNED.txt).py'],
  ['a variable', 'C:\\s\\$HOME-report.py'],
  ['a backtick', 'C:\\s\\back`tick.py'],
  ['parentheses', 'C:\\s\\report(v2).py'],
  ['a semicolon', 'C:\\s\\a;b.py'],
  ['braces', 'C:\\s\\{month}.py'],
  ['an ampersand', 'C:\\s\\a&b.py'],
  ['a space', 'C:\\s\\month end.py'],
]) {
  const cmd = ps(name);
  check(`powershell: ${label} in a filename is quoted literally`,
    cmd === `python '${name}'`, cmd);
}
check('powershell: an apostrophe is doubled, the PowerShell escape',
  ps("C:\\s\\month-end's.py") === "python 'C:\\s\\month-end''s.py'", ps("C:\\s\\month-end's.py"));

// 🔴 In PowerShell a bare quoted string is an EXPRESSION, not a command: it prints the path and
// exits 0. .cmd and .bat ship with an empty interpreter, so "Run with Script Progress" on any
// batch file under a folder with a space echoed the filename and never ran it - no error, exit
// code 0, so the extension's own exit-code hook stayed quiet too. The call operator is required.
check('powershell: a .cmd with no interpreter gets the call operator',
  ps('C:\\my scripts\\nightly.cmd', { '.cmd': '' }) === "& 'C:\\my scripts\\nightly.cmd'",
  ps('C:\\my scripts\\nightly.cmd', { '.cmd': '' }));
check('cmd.exe: the same file needs no call operator',
  commandForFile('C:\\my scripts\\nightly.cmd', { '.cmd': '' }, { shell: 'cmd', platform: 'win32' })
    === '"C:\\my scripts\\nightly.cmd"');

// The one case correct quoting cannot fix: cmd.exe expands %NAME% inside double quotes and has no
// command-line escape for it, so the interpreter is handed a filename that is not on disk.
check('cmd.exe: a %VAR% filename is reported as a hazard', !!shellHazard('C:\\logs\\run_%DATE%.py', 'cmd'));
check('powershell is unaffected by %, so no false alarm', shellHazard('C:\\logs\\run_%DATE%.py', 'powershell') === null);
check('an ordinary path raises no hazard', shellHazard('C:\\logs\\run.py', 'cmd') === null);

// vscode.env.shell is the only reliable answer to "which shell will receive this".
for (const [path_, want] of [['C:\\...\\powershell.exe', 'powershell'], ['/usr/bin/pwsh', 'powershell'],
  ['C:\\Windows\\System32\\cmd.exe', 'cmd'], ['/bin/bash', 'posix'], ['/usr/bin/zsh', 'posix'],
  ['C:\\Program Files\\Git\\bin\\bash.exe', 'posix']]) {
  check(`shellKindFor(${path_}) is ${want}`, shellKindFor(path_, 'win32') === want, shellKindFor(path_, 'win32'));
}
// Nothing to go on: PowerShell is VS Code's Windows default AND the safe direction to be wrong in,
// because its stricter quoting fails visibly rather than dangerously.
check('an unknown shell on Windows is treated as PowerShell', shellKindFor(undefined, 'win32') === 'powershell');
check('an unknown shell elsewhere is treated as POSIX', shellKindFor('', 'linux') === 'posix');

// 17c — the interpreters map is user input, and was trusted as if it were not.
let interpThrew = null;
try { commandForFile('/w/run.py', { '.py': 3 }, 'linux'); } catch (e) { interpThrew = e.message; }
check('a non-string interpreter does not throw out of the command handler', interpThrew === null, interpThrew || '');

// 🔴 defaultInterpreter promised "the moment someone sets their own interpreter, theirs is used
// verbatim" and could not keep it: it compared strings, not provenance, and matched .ps1 with
// /^powershell\b/i - so `powershell -NoProfile -NonInteractive -File`, `powershell.exe -File` for
// WSL interop and even `powershell-lts -File` were all thrown away and replaced wholesale.
check('an interpreter the user set is used verbatim',
  commandForFile('/h/deploy.ps1', { '.ps1': 'powershell -NoProfile -NonInteractive -File' },
    { platform: 'linux', userConfigured: ['.ps1'] }) === 'powershell -NoProfile -NonInteractive -File /h/deploy.ps1');
check('a value that merely starts with "powershell" is not swallowed',
  commandForFile('/h/deploy.ps1', { '.ps1': 'powershell-lts -File' }, 'linux') === 'powershell-lts -File /h/deploy.ps1',
  commandForFile('/h/deploy.ps1', { '.ps1': 'powershell-lts -File' }, 'linux'));
check('the untouched .ps1 default is still translated off Windows',
  commandForFile('/h/deploy.ps1', { '.ps1': 'powershell -ExecutionPolicy Bypass -File' }, 'linux')
    === 'pwsh -NoProfile -File /h/deploy.ps1');

// 17d — and the thing none of the above can prove: what a REAL PowerShell does with the string.
// Skipped off Windows; it is the only assertion here that actually executes anything.
test('a hostile filename runs the script and nothing else, in a real PowerShell',
  { skip: process.platform !== 'win32' && 'needs a real Windows PowerShell' }, () => {
    const os_ = require('os'), fsx = require('fs'), { spawnSync } = require('child_process');
    const dir = fsx.mkdtempSync(require('path').join(os_.tmpdir(), 'spd-ps-'));
    const file = require('path').join(dir, '$(ni PWNED.txt).py');
    fsx.writeFileSync(file, 'print("REAL SCRIPT RAN")\n', 'utf8');
    const script = require('path').join(dir, 'run.ps1');
    fsx.writeFileSync(script, ps(file), 'utf8');
    const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script],
      { cwd: dir, encoding: 'utf8', timeout: 60000 });
    const out = `${r.stdout || ''}${r.stderr || ''}`;
    assert.ok(/REAL SCRIPT RAN/.test(out), `the script did not run: ${out.slice(0, 200)}`);
    assert.equal(fsx.existsSync(require('path').join(dir, 'PWNED.txt')), false, 'the FILENAME executed');
    fsx.rmSync(dir, { recursive: true, force: true });
  });

// 17e — the 2026-09-04 review, batch D. Each of these was watched fail against the pre-fix build.
const { metricAnomalies } = require(path.join(repo, 'out/logic/anomaly.js'));
const { timelineModel } = require(path.join(repo, 'out/logic/timeline.js'));
const { complianceReport, coverage: coverageOf } = require(path.join(repo, 'out/logic/compliance.js'));
const { coverageFor } = require(path.join(repo, 'out/logic/summary.js'));
const { digestHtml } = require(path.join(repo, 'out/logic/digestHtml.js'));

const run = (task, iso, extra = {}) => ({ task, date: iso, success: true, elapsed: 10, warnings: 0, summary: '', ...extra });

// 🔴 metricAnomalies sliced its twenty-run window off UNSORTED history, and renderRunHistory hands
// it NEWEST-first — so every metric was measured against its twenty OLDEST runs. With history
// capped at 100 that is the normal case, and it inverts the detector.
{
  // The old runs and the recent ones must DIFFER, or the sort order cannot change the answer and
  // the test proves nothing: judged against the newest twenty a run at 1000 is perfectly normal,
  // judged against the twenty oldest it is a thousandfold rise.
  const hist = [];
  for (let i = 0; i < 12; i++) hist.push(run('T', `2026-07-${String(i + 1).padStart(2, '0')}T09:00:00`, { metrics: { rows: 1 } }));
  for (let i = 0; i < 20; i++) hist.push(run('T', `2026-08-${String(i + 1).padStart(2, '0')}T09:00:00`, { metrics: { rows: 1000 } }));
  const collapse = run('T', '2026-09-01T09:00:00', { metrics: { rows: 10 } });
  const newestFirst = [collapse, ...hist].sort((a, b) => b.date.localeCompare(a.date));
  check('a collapse is flagged even when history arrives newest-first',
    metricAnomalies(collapse, newestFirst, 2).some(m => m.key === 'rows'),
    JSON.stringify(metricAnomalies(collapse, newestFirst, 2)));
  check('a healthy run judged against RECENT history is not flagged',
    metricAnomalies(hist[31], newestFirst, 2).length === 0,
    JSON.stringify(metricAnomalies(hist[31], newestFirst, 2)));
}

// A +5/-4 oscillator is behaving exactly as expected; a delta reversing from +1200 to -1150 is not.
{
  const osc = [];
  for (let i = 0; i < 8; i++) osc.push(run('O', `2026-08-${String(i + 1).padStart(2, '0')}T09:00:00`, { metrics: { net: i % 2 ? 5 : -4 } }));
  const next = run('O', '2026-09-01T09:00:00', { metrics: { net: 5 } });
  check('an oscillating metric is not flagged every other run',
    metricAnomalies(next, [...osc, next], 2).length === 0,
    JSON.stringify(metricAnomalies(next, [...osc, next], 2)));

  const steady = [];
  for (let i = 0; i < 8; i++) steady.push(run('R', `2026-08-${String(i + 1).padStart(2, '0')}T09:00:00`, { metrics: { recon: 1200 + i } }));
  const reversed = run('R', '2026-09-01T09:00:00', { metrics: { recon: -1150 } });
  check('a sign reversal of a steady metric is flagged again',
    metricAnomalies(reversed, [...steady, reversed], 2).some(m => m.key === 'recon'),
    JSON.stringify(metricAnomalies(reversed, [...steady, reversed], 2)));
}

// A run with no usable duration cannot be compared, and must not claim it took its normal time.
{
  const prior = [];
  for (let i = 0; i < 10; i++) prior.push(run('D', `2026-08-${String(i + 1).padStart(2, '0')}T09:00:00`, { elapsed: 60 }));
  const zero = run('D', '2026-09-01T09:00:00', { elapsed: 0 });
  const v = durationVerdict(zero, [...prior, zero]);
  check('a zero-duration run is marked not comparable', v.comparable === false, JSON.stringify(v));
  check('a real run is comparable', durationVerdict(prior[9], prior).comparable === true);
  check('the bulk verdict agrees with the single one',
    durationVerdicts([...prior, zero]).get(zero).comparable === false);
}

// 🔴 The timeline quantised its right edge to the minute and used that for MEMBERSHIP too, so for
// up to sixty seconds a just-started run existed in Run History and in Active Task but not here.
{
  const now = new Date(2026, 8, 2, 10, 0, 45);
  const justNow = run('Quick', '2026-09-02T10:00:30', { startedAt: '2026-09-02T10:00:24', elapsed: 6 });
  const model = timelineModel({ ...base, history: [justNow] }, S({}), now);
  check('a run that started inside the current minute is on the timeline', model.runs === 1,
    `${model.runs} runs, ${model.lanes.length} lanes`);
}

// A script that died without complete() leaves status:"running" for ever; the timeline drew it as a
// live pulsing bar pinned to `now`, growing without bound, while Active Task said "Exited".
{
  const now = new Date(2026, 8, 2, 10, 0, 0);
  const dead = { task: 'Dead', status: 'running', step: 1, totalSteps: 2, label: 'Working', detail: '',
    elapsed: 60, updatedAt: '2026-09-02T04:00:00', startedAt: '2026-09-02T03:59:00', runId: 'r1', warnings: [], log: [], metrics: {}, artifacts: [], accessed: [] };
  const st = S({}); st.staleRunningMinutes = 30;
  const model = timelineModel({ ...base, tasks: [dead] }, st, now);
  const allBars = model.lanes.flatMap(l => l.bars);
  check('a stalled run is not drawn as a growing live bar', model.running === 0 && !allBars.some(b => b.running),
    `running=${model.running}, bars=${JSON.stringify(allBars.map(b => b.running))}`);
}

// 🔴 A period the process ran and FAILED is not "before it was wired".
{
  const hist = [];
  for (let m = 0; m < 6; m++) hist.push(run('Close', `2026-0${m + 1}-05T09:00:00`, { success: false }));
  hist.push(run('Close', '2026-07-05T09:00:00'));
  hist.push(run('Close', '2026-08-05T09:00:00'));
  const rep = complianceReport({ name: 'Close', frequency: 'monthly', dayOfMonth: 5 }, hist, new Date(2026, 8, 2), 8);
  const known = rep.periods.filter(x => x.known);
  check('failed periods count against compliance rather than reading "unknown"',
    known.length === 8 && rep.percent !== 100, `${known.length} known, ${rep.percent}%`);
}

// The truncation caveat must describe the WINDOW, not the file being full.
{
  // The file is FULL (100 rows) and forty of them are inside the 30-day window, so the window is
  // complete and the figure exact. Without runs in the window the "Runs succeeded" input is never
  // produced at all and the assertion passes on an empty string, proving nothing.
  const long = [];
  for (let i = 0; i < 60; i++) long.push(run('L', `2026-0${1 + Math.floor(i / 25)}-${String((i % 28) + 1).padStart(2, '0')}T09:00:00`));
  for (let i = 0; i < 40; i++) long.push(run('L', `2026-08-${String((i % 28) + 1).padStart(2, '0')}T09:00:00`));
  const recent = [];
  for (let i = 0; i < 100; i++) recent.push(run('L', `2026-09-0${(i % 2) + 1}T09:00:00`));
  const covLong = coverageOf([], long, 0, 0, new Date(2026, 8, 2), 30, { schedule: 2, success: 2, metrics: 1 }, 100);
  const covRecent = coverageOf([], recent, 0, 0, new Date(2026, 8, 2), 30, { schedule: 2, success: 2, metrics: 1 }, 100);
  check('a full file that still covers the window is not called truncated',
    !/history is full/.test(covLong.inputs.map(i => i.detail).join(' ')),
    covLong.inputs.map(i => i.detail).join(' '));
  check('a genuinely truncated window still says so',
    /history is full/.test(covRecent.inputs.map(i => i.detail).join(' ')),
    covRecent.inputs.map(i => i.detail).join(' '));
}

// One metric name reported by two scripts is two lines on the chart; reading the single newest
// point across both let a healthy loader hide a breached one.
{
  const st = S({ deltas: { formats: {}, thresholds: { rows_loaded: { min: 100 } }, points: 50 } });
  const data = { ...base, deltas: { rows_loaded: [
    { date: '2026-09-02T09:00:00', value: 5, task: 'Loader B' },
    { date: '2026-09-02T09:05:00', value: 5000, task: 'Loader A' },
  ] } };
  check('a breached metric is not hidden by a healthy sibling task',
    summaryFacts(data, st, NOW).metricsOutOfRange.includes('rows_loaded'),
    JSON.stringify(summaryFacts(data, st, NOW).metricsOutOfRange));
}

// A user-settable key must not reach the prototype. data.deltas['constructor'] yielded the Object
// constructor, whose .length is 1, so the emptiness guard passed and the render threw.
{
  const st = S({ deltas: { formats: {}, thresholds: { constructor: { min: 0 }, toString: { max: 1 } }, points: 50 } });
  let threw = null;
  try { summaryFacts({ ...base, deltas: {} }, st, NOW); } catch (e) { threw = e.message; }
  check('a prototype key in thresholds cannot blank the dashboard', threw === null, threw || '');
}

// 🔴 The emailed digest and the dashboard must produce the SAME coverage figure. They did not: a
// 7-day window against 30, a metrics term crediting never-reported thresholds, and no regard at
// all for coverage.show.
{
  const st = S({ processes: [{ name: 'P', label: 'P', frequency: 'daily' }],
    deltas: { formats: {}, thresholds: { never_reported: { min: 0, max: 1 } }, points: 50 } });
  const hist = [];
  for (let i = 1; i <= 20; i++) hist.push(run('P', `2026-08-${String(i).padStart(2, '0')}T09:00:00`, { success: i > 5 }));
  const data = { ...base, history: hist };
  const html = digestHtml(data, st, NOW);
  const cov = coverageFor(data, st, NOW);
  check('the emailed coverage figure equals the dashboard one',
    !cov || html.includes(`Coverage ${cov.percent}%`), `${cov && cov.percent}% vs ${(html.match(/Coverage (\d+)%/) || [])[1]}`);
  check('a threshold that never reported does not earn a full mark',
    !cov.inputs.some(i => /1\/1 metric/.test(i.detail)), cov.inputs.map(i => i.detail).join(' · '));

  const off = S({ ...st, coverage: { show: false, weights: { schedule: 2, success: 2, metrics: 1 } } });
  off.processes = st.processes; off.deltas = st.deltas; off.coverage = { show: false, weights: { schedule: 2, success: 2, metrics: 1 } };
  check('coverage.show:false is honoured by the emailed digest too',
    !/Coverage \d+%/.test(digestHtml(data, off, NOW)),
    (digestHtml(data, off, NOW).match(/Coverage \d+%/) || [''])[0]);
}

// A future-dated run must not count toward "this week" in one half of an email and be excluded by
// the other half.
{
  const st = S({ processes: [] });
  const data = { ...base, history: [run('P', '2026-09-02T09:00:00'), run('P', '2027-01-01T09:00:00')] };
  const html = digestHtml(data, st, NOW);
  check('a future-dated run is not counted in the digest headline', /">1<\/div>\s*<div[^>]*>runs/.test(html) || html.includes('>1<'),
    (html.match(/>(\d+)<\/div><div[^>]*>runs/) || [])[1]);
}

// An exit overlay belongs to ONE run. A ~2 s window let a brand-new run inherit a dead one's code.
{
  const prog = { task: 'T', status: 'running', runId: 'new', startedAt: '2026-09-02T10:00:00', elapsed: 1, updatedAt: '2026-09-02T10:00:01', step: 0, totalSteps: 0, label: '', detail: '', warnings: [], log: [], metrics: {}, artifacts: [], accessed: [] };
  const stale = [{ task: 'T', exitCode: 137, when: '2026-09-02T10:00:00', runId: 'old' }];
  check('an exit from a previous run does not attach to a new one', exitOverlayFor(prog, stale) === null);
  check('an exit from THIS run still attaches',
    exitOverlayFor(prog, [{ task: 'T', exitCode: 1, when: '2026-09-02T10:00:01', runId: 'new' }]) !== null);
}

// 17f — the 2026-09-04 review, batch F: what the page SHOWS.
const warn = (msg, at, over = {}) => ({ time: at, msg, ...over });
const slot = (name, warnings, over = {}) => ({
  task: name, status: 'running', step: 1, totalSteps: 2, label: 'Working', detail: '',
  elapsed: 10, eta: null, warnings, log: [], metrics: {}, artifacts: [], accessed: [],
  updatedAt: '2026-09-02T10:00:00', startedAt: '2026-09-02T09:59:00', runId: name, ...over,
});

// 🔴 The 40-card cap sliced a list built by concatenating each task in slot order, so it was "the
// first 40 of task A", not "the 40 newest". With three scripts running, one vanished entirely and
// the footer called its warnings "older" though they were the newest on the page.
{
  const noisy = slot('Noisy', Array.from({ length: 45 }, (_, i) => warn(`noise ${i}`, `2026-09-02T09:${String(i % 60).padStart(2, '0')}:00`)));
  const quiet = slot('Quiet', [warn('THE ONE THAT MATTERS', '2026-09-02T10:00:30')]);
  const html = render({ ...base, tasks: [noisy, quiet] }, S({}));
  check('a quiet script is not pushed off the Warnings card by a noisy one',
    /THE ONE THAT MATTERS/.test(html), 'the newest warning on the page was hidden');
  const cards = (html.match(/class="warning-card"/g) || []).length;
  check('the card is still capped', cards <= 40, `${cards} cards`);
}

// One malformed entry must not take the whole page down, and the entries are cleaned at the read
// boundary as well as guarded here.
{
  const bad = slot('Bad', [null, warn('real one', '2026-09-02T10:00:00'), 'not an object']);
  let threw = null;
  let html = '';
  try { html = render({ ...base, tasks: [bad] }, S({})); } catch (e) { threw = e.message; }
  check('a null inside a warnings array does not throw out of the render', threw === null, threw || '');
  check('the surviving warning is still shown', /real one/.test(html));
}

// 🔴 And the net under all of it: nothing between renderSections and the webview catches anything,
// so one throwing section used to stop the post entirely and the webview showed its last-good HTML
// for ever, with no error anywhere.
{
  const poisoned = { task: 'T', date: '2026-09-02T09:00:00', success: true, elapsed: 1, warnings: 0, summary: '' };
  Object.defineProperty(poisoned, 'metrics', { get() { throw new Error('poisoned metric'); }, enumerable: true });
  let threw = null;
  let html = '';
  try { html = render({ ...base, history: [poisoned] }, S({})); } catch (e) { threw = e.message; }
  check('a throwing section does not blank the dashboard', threw === null, threw || '');
  check('the failure is reported on the page rather than swallowed', /could not be drawn/.test(html),
    html.slice(0, 160));
  check('the other sections still render', (html.match(/<section /g) || []).length > 1);
}

// Pending Actions: the section whose job is "what a human has to do" hid the errors.
{
  const items = [];
  // Reported in the order the finding describes: 25 info notes and THEN 5 errors. pendingActions
  // sorts by run date, which every item of one run shares, so array order is what survives to the
  // cap — the errors are last and used to be the ones cut.
  for (let i = 0; i < 25; i++) items.push({ time: '2026-09-02T09:00:00', msg: `note ${i}`, actionable: true, severity: 'info' });
  for (let i = 0; i < 5; i++) items.push({ time: '2026-09-02T09:30:00', msg: `ERROR ${i}`, actionable: true, severity: 'error' });
  const row = { task: 'Recon', date: '2026-09-02T09:40:00', success: true, elapsed: 5, warnings: 30, summary: '', warningItems: items };
  const html = render({ ...base, history: [row] }, S({}));
  // 🔴 Scoped to the section that owns it. Run History's expanded row prints warningItems too, so
  // matching the whole page would pass with Pending Actions showing nothing but info notes.
  const pa = (html.match(/<section[^>]*data-section="pendingActions"[\s\S]*?(?=<section|$)/) || [''])[0];
  check('an error-level finding survives the per-task cap', /ERROR 0/.test(pa),
    'the 25 info notes filled the cap and hid every error');
  check('the "more" line explains what Run History will show', /newest 15 runs/.test(html),
    (html.match(/more from[^<]*/) || [])[0] || '');
}

// The wiring-gap message must not appear while the findings are on screen beside it.
{
  const live = slot('New Script', [warn('12 rows had no owner', '2026-09-02T10:00:00', { actionable: true })]);
  const html = render({ ...base, tasks: [live] }, S({}));
  check('a live run counts as "the reporter is wired up"',
    !/Nothing is marked as needing action yet/.test(html));
}

// 🔴 Half a fix is a contradiction: summaryFacts stopped counting future-dated runs and the Last
// Completed card did not, so the strip and the card described two different runs.
{
  const older = { task: 'A', date: '2026-09-02T09:00:00', success: true, elapsed: 42, warnings: 0, summary: 'fine' };
  const future = { task: 'B', date: '2027-01-01T09:00:00', success: false, elapsed: 3, warnings: 0, summary: 'skewed clock' };
  const html = render({ ...base, history: [older, future] }, S({}));
  const card = (html.match(/<section[^>]*data-section="lastCompleted"[\s\S]*?(?=<section|$)/) || [''])[0];
  check('Last Completed ignores a future-dated run, like the strip does',
    /fine/.test(card) && !/skewed clock/.test(card), card.replace(/<[^>]+>/g, ' ').slice(0, 120));
}

// Coverage: three reasons for "no number", three different sentences.
{
  // A monthly process not yet due this month, whose only run is outside the 30-day window: no
  // schedule input (pending is excluded by design) and no success input, so coverage has genuinely
  // nothing to measure. An empty history would instead hit the "no script has reported yet" page.
  const st = S({ processes: [{ name: 'P', label: 'P', frequency: 'monthly', dayOfMonth: 25 }] });
  const html = render({ ...base, history: [{ task: 'P', date: '2026-07-25T09:00:00', success: true, elapsed: 1, warnings: 0, summary: '' }] }, st);
  check('a day-one user is not told to raise weights that are already 2/2/1',
    !/every weight is 0/.test(html), 'the zero-weights message fired with the shipped weights');
  check('and is told what coverage is actually waiting for', /nothing to measure yet/.test(html),
    (html.match(/tiles-note[^>]*>([^<]*)/) || [])[1] || 'no coverage note at all');

  const zero = S({ processes: [{ name: 'P', label: 'P', frequency: 'daily' }] });
  zero.coverage = { show: true, weights: { schedule: 0, success: 0, metrics: 0 } };
  check('genuinely zero weights still say so',
    /every weight is 0/.test(render({ ...base, history: [{ task: 'P', date: '2026-09-02T09:00:00', success: true, elapsed: 1, warnings: 0, summary: '' }] }, zero)));
}

// The printed arithmetic must be the arithmetic that was used.
{
  const st = S({ processes: [{ name: 'P', label: 'P', frequency: 'daily' }] });
  const html = render({ ...base, history: [{ task: 'P', date: '2026-09-02T09:00:00', success: true, elapsed: 1, warnings: 0, summary: '' }] }, st);
  const note = (html.match(/Coverage \d+% = [^<]*(?:<span[^>]*>[^<]*<\/span>)?/) || [''])[0];
  const inputs = (note.match(/·/g) || []).length;
  const weights = ((note.match(/weights ([\d/]+)/) || [])[1] || '').split('/').length;
  check('the note prints one weight per input it lists', weights <= inputs + 1,
    `note was: ${note}`);
}

// A sentinel is not a duration.
{
  const noStamp = slot('Silent', [], { updatedAt: undefined, elapsed: 60 });
  const html = render({ ...base, tasks: [noStamp], progress: noStamp }, S({}));
  check('a missing updatedAt does not print "Infinity min"', !/Infinity/.test(html),
    (html.match(/[^<>]*Infinity[^<>]*/) || [])[0] || '');
}

// A failed run that was also slow must still look failed.
{
  const css = fs.readFileSync(path.join(repo, 'media/sections/timeline.css'), 'utf8');
  check('the fail colour is declared after the slow colour, so a failed+slow bar reads as failed',
    css.indexOf('.tl-bar-fail,') > css.indexOf('.tl-bar-slow {'),
    'equal specificity means the later rule wins, and both classes can be on one bar');
}

// 🔴 The shipped Get Started walkthrough said "Thirteen sections… six on by default" while
// package.json contributed FIFTEEN with NINE on — and named processCalendar and scriptHealth as
// off when both are on. It is the first thing a new user reads, and nothing checked it, so it
// drifted for three releases. A doc that restates a manifest needs a test, not a correction.
{
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'));
  // `contributes.configuration` is an ARRAY of titled groups here, not one object.
  const groups = pkg.contributes.configuration;
  const props = Object.assign({}, ...(Array.isArray(groups) ? groups : [groups]).map(g => g.properties || {}));
  const sections = Object.entries(props)
    .filter(([k]) => /^scriptProgress\.sections\./.test(k))
    .map(([k, v]) => [k.split('.').pop(), v.default === true]);
  const on = sections.filter(([, d]) => d).map(([k]) => k);
  const off = sections.filter(([, d]) => !d).map(([k]) => k);
  const words = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen'];
  const md = fs.readFileSync(path.join(repo, 'media/walkthrough/4-sections.md'), 'utf8');

  check('the walkthrough states the number of sections that actually ship',
    md.includes(`${words[sections.length]} sections`), `package.json contributes ${sections.length}`);
  check('and how many are on by default',
    new RegExp(`${words[on.length]} are on by default`, 'i').test(md), `${on.length} are on`);
  for (const name of on) {
    check(`the walkthrough lists ${name} as on by default`,
      new RegExp(`on by default[\\s\\S]{0,260}\\b${name}\\b`).test(md));
  }
  for (const name of off) {
    check(`the walkthrough lists ${name} as off by default`,
      new RegExp(`start off|The other[\\s\\S]{0,200}\\b${name}\\b`).test(md), name);
  }
  const order = (md.match(/"scriptProgress\.dashboard\.sectionOrder": \[([\s\S]*?)\]/) || [, ''])[1];
  const listed = (order.match(/"([a-zA-Z]+)"/g) || []).map(x => x.replace(/"/g, ''));
  check('the sectionOrder example lists every section',
    sections.every(([k]) => listed.includes(k)),
    `missing: ${sections.filter(([k]) => !listed.includes(k)).map(([k]) => k).join(', ')}`);
}

// 🔴 The Privacy section is what a security reviewer reads before approving the install, and it
// claimed the username reaches the CSV export — which has no user column at all — while stating
// the HTML report unconditionally, with no mention of report.includeIdentity being off by default.
// It frightened a reader off a clean export and hid the one real path. A claim about where a
// personal identifier goes is exactly the kind that must be checked rather than written down.
{
  const withUser = [{ task: 'T', date: '2026-09-02T09:00:00', success: true, elapsed: 1, warnings: 0,
    summary: 'x', user: 'SECRETUSER', commit: 'abc1234' }];
  check('the CSV export carries no username or commit',
    !/SECRETUSER|abc1234/.test(historyCsv(withUser)), historyCsv(withUser).split(/\r?\n/)[0]);
  check('the formatted digest carries no username',
    !/SECRETUSER/.test(digestHtml({ ...base, history: withUser }, S({}), NOW)));
  const readme = fs.readFileSync(path.join(repo, 'README.md'), 'utf8');
  check('and the README no longer says otherwise',
    !/the CSV export and the HTML report/.test(readme),
    'the Privacy section still claims the username reaches the CSV export');
  check('the README names includeIdentity where it matters',
    /report\.includeIdentity`? is on; it is \*\*off by default\*\*/.test(readme),
    'the HTML-report claim is stated without its opt-in');
}

// 18 — runbook stamps local time
const rb = runbookMarkdown({ ...base, history: big.slice(0, 5) }, S({}), NOW);
check('runbook is stamped in local time', rb.includes('2026-09-02 10:00'), (rb.match(/_Generated [^_]+_/) || [])[0]);

// 19 — a duplicated section id renders once
{
  const s = S({}); s.sectionOrder = ['runHistory', 'runHistory', 'summary'];
  const h = render({ ...base, history: big.slice(0, 5) }, s);
  check('a duplicated sectionOrder entry renders once', (h.match(/data-section="runHistory"/g) || []).length === 1,
    (h.match(/data-section="runHistory"/g) || []).length);
}
