// Regression tests for defects found by the 1.6.0 adversarial review.
//
// Every one of these failed before 1.6.0. They live here rather than in a scratch file because
// the reviews that found them were expensive, and a defect nobody has a test for is a defect
// that comes back. Each block names the symptom a user would have seen.
const test = require('node:test');
const assert = require('node:assert/strict');
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
const { commandForFile } = require(path.join(repo, 'out/logic/shell.js'));
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

// 8 — dependsOn validation
const probs = validateSettings({ processes: [{ name: 'Daily Load', label: 'Daily', frequency: 'daily', dependsOn: ['Upstrem Extract'] }] });
check('a dependsOn naming nothing is reported', probs.some(p => /Upstrem Extract/.test(p.message || String(p))), JSON.stringify(probs));
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
check('windows doubles a quote rather than backslashing it', commandForFile('C:\\a b\\r".py', { '.py': 'python' }, 'win32').includes('""'),
  commandForFile('C:\\a b\\r".py', { '.py': 'python' }, 'win32'));

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
