// The files that were "named by a test" but barely executed by one.
//
// 🔴 The coverage sweep after 1.7.5 said zero source files were untested. That was true and
// misleading: the sweep only asks whether any test MENTIONS a file. Measured properly
// (`node --test --experimental-test-coverage`) four of those "covered" files were at 26-67% of
// lines, and `logic/buttons.js` — which decides whether a button that runs shell text from
// settings is pressable — was at 13.3% of BRANCHES. A file can be imported by a render test,
// contribute one line of output, and have every decision in it unexercised.
//
// So: line coverage is the measurement, file coverage is not. These are the tests for the
// decisions those four files actually make.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const { buttonEnabled } = require(path.join(repo, 'out/logic/buttons.js'));
const { runbookMarkdown } = require(path.join(repo, 'out/logic/runbook.js'));
const { comparisonText } = require(path.join(repo, 'out/logic/compareText.js'));
const { compareRuns } = require(path.join(repo, 'out/logic/compare.js'));
const { renderImpact } = require(path.join(repo, 'out/render/impact.js'));
const { settings: S } = require('./fixtures/settings.js');

const run = (over = {}) => ({
  task: 'Nightly', date: '2026-09-05T09:00:00', success: true, elapsed: 60,
  warnings: 0, summary: '', ...over,
});

// ================================================================ logic/buttons.ts
//
// A button that is wrongly DISABLED is a control the user cannot reach with no way to override
// it; a button wrongly ENABLED costs one unnecessary run. The module says so, and every default
// below leans that way — so the tests that matter most are the ones proving it does not disable
// on nonsense.

test('no rule, no metric, no task: the button stays pressable', () => {
  assert.deepEqual(buttonEnabled(undefined, 'Nightly', []), { enabled: true, reason: '' });
  assert.equal(buttonEnabled({}, 'Nightly', []).enabled, true, 'a rule with no metric decides nothing');
  assert.equal(buttonEnabled({ metric: 'issues', gt: 0 }, undefined, []).enabled, true, 'no task to look up');
  assert.equal(buttonEnabled({ metric: 'issues', gt: 0 }, '   ', []).enabled, true, 'a blank task is no task');
});

test('an unknown history leaves the button enabled', () => {
  const r = { metric: 'issues', gt: 0 };
  assert.equal(buttonEnabled(r, 'Nightly', []).enabled, true, 'a fresh install must not look broken');
  assert.equal(buttonEnabled(r, 'Nightly', [run({ task: 'Other', metrics: { issues: 0 } })]).enabled, true,
    'a different task says nothing about this one');
  assert.equal(buttonEnabled(r, 'Nightly', [run({ success: false, metrics: { issues: 0 } })]).enabled, true,
    'a FAILED run is not evidence that there is nothing to fix');
  assert.equal(buttonEnabled(r, 'Nightly', [run({ metrics: { other: 0 } })]).enabled, true,
    'the run did not report this metric at all');
});

test('it reads the most recent successful run, not the first in the array', () => {
  const history = [
    run({ date: '2026-09-01T09:00:00', metrics: { issues: 5 } }),   // older, has work
    run({ date: '2026-09-06T09:00:00', metrics: { issues: 0 } }),   // newest, clean
    run({ date: '2026-09-07T09:00:00', success: false, metrics: { issues: 9 } }), // newer but failed
  ];
  const v = buttonEnabled({ metric: 'issues', gt: 0 }, 'Nightly', history);
  assert.equal(v.enabled, false, 'the newest SUCCESSFUL run found nothing to fix');
  assert.match(v.reason, /issues = 0/);
});

test('every numeric comparison, in both directions', () => {
  const h = (n) => [run({ metrics: { issues: n } })];
  const check = (rule, value) => buttonEnabled({ metric: 'issues', ...rule }, 'Nightly', h(value));

  assert.equal(check({ gt: 0 }, 3).enabled, true);
  assert.equal(check({ gt: 0 }, 0).enabled, false);
  assert.equal(check({ gt: 0 }, 0).reason, 'last run had issues = 0, needs more than 0');

  assert.equal(check({ gte: 2 }, 2).enabled, true);
  assert.equal(check({ gte: 2 }, 1).enabled, false);
  assert.equal(check({ gte: 2 }, 1).reason, 'last run had issues = 1, needs at least 2');

  assert.equal(check({ lt: 5 }, 4).enabled, true);
  assert.equal(check({ lt: 5 }, 5).enabled, false);
  assert.equal(check({ lt: 5 }, 5).reason, 'last run had issues = 5, needs less than 5');

  assert.equal(check({ lte: 5 }, 5).enabled, true);
  assert.equal(check({ lte: 5 }, 6).enabled, false);
  assert.equal(check({ lte: 5 }, 6).reason, 'last run had issues = 6, needs at most 5');
});

test('eq compares numbers as numbers and strings as strings', () => {
  const h = (v) => [run({ metrics: { status: v } })];
  const check = (eq, v) => buttonEnabled({ metric: 'status', eq }, 'Nightly', h(v));

  assert.equal(check(0, 0).enabled, true);
  assert.equal(check(0, 1).enabled, false);
  assert.equal(check(0, 1).reason, 'last run had status = 1, expected 0');
  // The reporter stringifies anything that is not a bare int/float, so an ordinary metric can
  // arrive as "0". A numeric rule must still recognise it.
  assert.equal(check(0, '0').enabled, true, 'a number reported as a string is still that number');

  assert.equal(check('clean', 'clean').enabled, true);
  assert.equal(check('clean', 'dirty').enabled, false);
  assert.equal(check('clean', 'dirty').reason, 'last run had status = "dirty", expected "clean"');
});

test('a non-numeric value never disables a numeric rule', () => {
  // 🔴 The regression the module documents. Number('') and Number(null) are both 0, so an empty
  // or absent value used to disable the button with the nonsense reason
  // 'last run had issues = "", needs more than 0' — a control the user cannot press, explained
  // by a sentence that is not true.
  for (const bad of ['', '   ', 'n/a', null, true, [], {}]) {
    const h = [run({ metrics: { issues: bad } })];
    assert.equal(buttonEnabled({ metric: 'issues', gt: 0 }, 'Nightly', h).enabled, true,
      `value ${JSON.stringify(bad)} is not a number and must not disable the button`);
    assert.equal(buttonEnabled({ metric: 'issues', eq: 0 }, 'Nightly', h).enabled, true,
      `value ${JSON.stringify(bad)} has nothing numeric to compare against eq: 0`);
  }
});

test('the rule\'s own task wins over the button\'s task', () => {
  const history = [
    run({ task: 'Audit', metrics: { issues: 0 } }),
    run({ task: 'Nightly', metrics: { issues: 7 } }),
  ];
  assert.equal(buttonEnabled({ metric: 'issues', gt: 0, task: 'Audit' }, 'Nightly', history).enabled, false,
    'the rule named Audit, so Nightly\'s 7 issues are irrelevant');
});

// ================================================================ logic/runbook.ts
//
// This document is read by whoever is covering in an emergency. Its stated contract is that it
// marks its own blind spots rather than presenting a tidy list that silently omits them -- so
// the tests are mostly about what it REFUSES to claim.

const GAP = /if a person does anything here/;

function bookFor(over = {}) {
  const data = {
    progress: null, tasks: [], history: over.history || [], deltas: {}, impact: {},
    access: over.access !== undefined ? over.access : null, overlays: [],
    logsDir: 'C:/ws/logs', logsDirExists: true, readErrors: [],
  };
  const s = S({ processes: over.processes || [], buttons: over.buttons || [] });
  return runbookMarkdown(data, s, over.now || new Date('2026-09-07T10:30:00'));
}

test('with no processes configured it says so instead of producing an empty document', () => {
  const md = bookFor();
  assert.match(md, /No processes are configured/);
  assert.match(md, /processCalendar\.processes/, 'and it says what to add');
  assert.doesNotMatch(md, /^## Step/m);
});

test('the DRAFT banner and the blind-spot warning are always on the front', () => {
  const md = bookFor({ processes: [{ name: 'Nightly', label: 'Nightly', frequency: 'daily' }] });
  assert.match(md, /⚠️ DRAFT — generated, not reviewed/);
  assert.match(md, /cannot see steps performed by a person/);
});

test('the generation stamp is local time, not UTC', () => {
  // A runbook generated at 09:00 in UTC-4 was stamped 13:00 with no marker, in a product whose
  // every other date is local. Anyone reconciling it against a log would have been an hour --
  // or five -- out.
  const now = new Date(2026, 8, 7, 9, 5, 0); // local 09:05, whatever the machine's zone
  const md = bookFor({ now, processes: [{ name: 'Nightly', label: 'Nightly', frequency: 'daily' }] });
  assert.match(md, /09:05/, `expected the local wall clock in:\n${md.split('\n')[2]}`);
});

test('a gap marker sits before the first step and after every step, single-step included', () => {
  // The human step is very often the LAST one -- send the file, wait for sign-off. A marker that
  // only appeared between declared phases meant a single-step process, which is the common case,
  // generated a clean confident document with no warnings at all.
  const md = bookFor({
    processes: [{ name: 'Nightly', label: 'Nightly', frequency: 'daily' }],
    history: [run({ task: 'Nightly' })],
  });
  const gaps = md.split('\n').filter(l => GAP.test(l));
  assert.equal(gaps.length, 2, 'one before step 1 and one after it');
  assert.match(md, /Before step 1/);
  assert.match(md, /After step 1/);
});

test('each declared phase becomes its own step, each followed by a gap', () => {
  const md = bookFor({
    processes: [{ name: 'Load', label: 'Monthly Load', frequency: 'monthly', subtasks: ['Extract', 'Transform', 'Publish'] }],
    history: [run({ task: 'Extract' }), run({ task: 'Transform' }), run({ task: 'Publish' })],
  });
  assert.match(md, /### Step 1 — Extract/);
  assert.match(md, /### Step 2 — Transform/);
  assert.match(md, /### Step 3 — Publish/);
  assert.equal(md.split('\n').filter(l => GAP.test(l)).length, 4, 'before step 1, and after each of the three');
});

test('a step it has never seen run says so instead of inventing detail', () => {
  const md = bookFor({
    processes: [{ name: 'Load', label: 'Load', frequency: 'monthly', subtasks: ['Extract', 'Publish'] }],
    history: [run({ task: 'Extract', elapsed: 120 })],
  });
  assert.match(md, /### Step 2 — Publish\n\n⚠️ \*\*This tool has never seen this step run\*\*/);
  assert.match(md, /Usually takes/, 'and step 1, which it HAS seen, still reports its duration');
});

test('only an exact task match prints a command — no command beats the wrong one', () => {
  // The prefix fallback that used to be here printed the phase-1 command under a phase-3
  // heading, in a fenced block, with no caveat, in the document someone follows during an
  // incident.
  const md = bookFor({
    processes: [{ name: 'Load', label: 'Load', frequency: 'monthly', subtasks: ['Load', 'Load Archive'] }],
    history: [run({ task: 'Load' }), run({ task: 'Load Archive' })],
    buttons: [{ label: 'Run load', command: 'python load.py', task: 'Load' }],
  });
  assert.match(md, /```\npython load\.py\n```/, 'step 1 has an exact match');
  const archive = md.slice(md.indexOf('### Step 2 — Load Archive'));
  assert.doesNotMatch(archive, /python load\.py/, 'step 2 must not borrow step 1\'s command');
  assert.match(archive, /No Quick Action is configured for this step/);
});

test('a step name does not absorb a longer step\'s runs or writes', () => {
  // "Load" absorbing "Load Archive" would tell an emergency reader that this step writes a table
  // it never touches, and would fold the wrong durations into its median.
  const md = bookFor({
    processes: [{ name: 'Load', label: 'Load', frequency: 'monthly', subtasks: ['Load'] }],
    history: [
      run({ task: 'Load', elapsed: 10 }),
      run({ task: 'Load Archive', elapsed: 6000 }),
    ],
    access: {
      nodes: [{ id: 'task:Load' }, { id: 'task:Load Archive' }, { id: 'table:archive', label: 'archive_tbl' }],
      edges: [{ from: 'task:Load Archive', to: 'table:archive', mode: 'write' }],
    },
  });
  assert.match(md, /median of 1 successful run/, 'the 6000s Load Archive run is not this step\'s');
  assert.doesNotMatch(md, /archive_tbl/, 'nor is Load Archive\'s write edge');
});

test('a decorated task name still belongs to its step; a different name does not', () => {
  // The separator set is the whole fix, so it gets asserted directly rather than inferred from
  // one example. Punctuation (optionally after a space) decorates a name; a bare space starts a
  // different one, because that is how English separates two words.
  const belongs = (task) => {
    const md = bookFor({
      processes: [{ name: 'Load', label: 'Load', frequency: 'monthly' }],
      history: [run({ task, elapsed: 42 })],
    });
    return /Usually takes \*\*42s\*\*/.test(md);
  };
  for (const t of ['Load', 'Load: phase 1', 'Load_archive', 'Load-extract', 'Load/step', 'Load(1)', 'Load (phase 1)']) {
    assert.equal(belongs(t), true, `"${t}" should belong to step Load`);
  }
  for (const t of ['Load Archive', 'Load Backup Job', 'Loader', 'Unload', 'Reload']) {
    assert.equal(belongs(t), false, `"${t}" is a different script and must not be folded into Load`);
  }
});

test('a configured sibling reclaims a task that would otherwise fall to a shorter step', () => {
  // The second half of the fix: even where the separator rule allows a prefix match, the longest
  // CONFIGURED step name wins, so "Load: archive" goes to the step that is actually called that.
  const md = bookFor({
    processes: [{ name: 'Load', label: 'Load', frequency: 'monthly', subtasks: ['Load', 'Load: archive'] }],
    history: [run({ task: 'Load', elapsed: 10 }), run({ task: 'Load: archive', elapsed: 6000 })],
  });
  const step1 = md.slice(md.indexOf('### Step 1 — Load\n'), md.indexOf('### Step 2'));
  assert.match(step1, /Usually takes \*\*10s\*\* \(median of 1 successful run/, 'step 1 keeps only its own run');
  const step2 = md.slice(md.indexOf('### Step 2 — Load: archive'));
  assert.match(step2, /Usually takes \*\*1h40m\*\*/, 'and step 2 gets the one that names it');
});

test('a phased process that ran under a phase name is not reported as never observed', () => {
  // Claiming "never seen" about a process that ran this morning is exactly the wrong thing to
  // tell someone covering in an emergency.
  const md = bookFor({
    processes: [
      { name: 'Month End', label: 'Month End', frequency: 'monthly', subtasks: ['Extract'] },
      { name: 'Ghost', label: 'Ghost', frequency: 'daily' },
    ],
    history: [run({ task: 'Extract' })],
  });
  assert.match(md, /## ⚠️ Not yet observed/);
  const tail = md.slice(md.indexOf('Not yet observed'));
  assert.match(tail, /Ghost/);
  assert.doesNotMatch(tail, /Month End/, 'its phase ran, so the process has been observed');
});

test('with everything observed there is no "not yet observed" section at all', () => {
  const md = bookFor({
    processes: [{ name: 'Nightly', label: 'Nightly', frequency: 'daily' }],
    history: [run({ task: 'Nightly' })],
  });
  assert.doesNotMatch(md, /Not yet observed/);
});

test('cadence reads correctly for each frequency, with and without its optional field', () => {
  const line = (p) => bookFor({ processes: [p] }).split('\n').find(l => l.startsWith('- **Runs:**'));
  assert.equal(line({ name: 'A', frequency: 'daily' }), '- **Runs:** daily');
  assert.equal(line({ name: 'A', frequency: 'daily', dueHour: 9 }), '- **Runs:** daily, expected by 09:00');
  assert.equal(line({ name: 'A', frequency: 'weekly' }), '- **Runs:** weekly');
  assert.equal(line({ name: 'A', frequency: 'weekly', dayOfWeek: 3 }), '- **Runs:** weekly, by day 3 of the week');
  assert.equal(line({ name: 'A', frequency: 'monthly' }), '- **Runs:** monthly');
  assert.equal(line({ name: 'A', frequency: 'monthly', dayOfMonth: 5 }), '- **Runs:** monthly, by day 5');
});

test('dependencies and a time budget are stated when configured', () => {
  const md = bookFor({
    processes: [{ name: 'Publish', label: 'Publish', frequency: 'monthly', dependsOn: ['Extract', 'Transform'], maxMinutes: 45 }],
  });
  assert.match(md, /\*\*Cannot start until:\*\* Extract, Transform has run this period/);
  assert.match(md, /\*\*Expected to finish within:\*\* 45 minutes/);
});

test('the median duration counts successes only, and takes the middle value', () => {
  const md = bookFor({
    processes: [{ name: 'Nightly', label: 'Nightly', frequency: 'daily' }],
    history: [
      run({ task: 'Nightly', elapsed: 10, date: '2026-09-01T09:00:00' }),
      run({ task: 'Nightly', elapsed: 30, date: '2026-09-02T09:00:00' }),
      run({ task: 'Nightly', elapsed: 20, date: '2026-09-03T09:00:00' }),
      run({ task: 'Nightly', elapsed: 9999, success: false, date: '2026-09-04T09:00:00' }),
    ],
  });
  assert.match(md, /Usually takes \*\*20s\*\* \(median of 3 successful run\(s\)\)/);
});

test('reads, writes and artifacts are listed, deduplicated and sorted', () => {
  const md = bookFor({
    processes: [{ name: 'Nightly', label: 'Nightly', frequency: 'daily' }],
    history: [
      run({ task: 'Nightly', artifacts: ['out.csv', 'log.txt'] }),
      run({ task: 'Nightly', artifacts: ['out.csv'], date: '2026-09-04T09:00:00' }),
    ],
    access: {
      nodes: [{ id: 'file:b', label: 'beta.csv' }, { id: 'file:a', label: 'alpha.csv' }, { id: 'table:t' }],
      edges: [
        { from: 'task:Nightly', to: 'file:b', mode: 'read' },
        { from: 'task:Nightly', to: 'file:a', mode: 'read' },
        { from: 'task:Nightly', to: 'file:b', mode: 'read' },
        { from: 'task:Nightly', to: 'table:t', mode: 'write' },
      ],
    },
  });
  assert.match(md, /- Reads: `alpha\.csv`, `beta\.csv`$/m, 'sorted and deduplicated');
  assert.match(md, /- \*\*Writes: `t`\*\*/, 'a node with no label falls back to its id without the prefix');
  assert.match(md, /- Produces: `out\.csv`, `log\.txt`/);
});

test('a step with no access edges says the graph is missing, not that it touches nothing', () => {
  const md = bookFor({
    processes: [{ name: 'Nightly', label: 'Nightly', frequency: 'daily' }],
    history: [run({ task: 'Nightly' })],
  });
  assert.match(md, /⚠️ No inputs or outputs recorded\. Add `p\.access\(\.\.\.\)`/);
});

test('a malformed access graph is ignored rather than thrown on', () => {
  // access.json is validated only as far as `nodes` being an array, so the file on disk -- which
  // any script can write -- may carry anything at all.
  for (const access of [
    { nodes: [], edges: 'not an array' },
    { nodes: 'not an array', edges: [] },
    { edges: [{ from: 'task:Nightly', to: 'x', mode: 'read' }] },
    { nodes: [], edges: [null, {}, { from: 5, to: 6 }, { from: 'task:Nightly' }] },
  ]) {
    assert.doesNotThrow(() => bookFor({
      access,
      processes: [{ name: 'Nightly', label: 'Nightly', frequency: 'daily' }],
      history: [run({ task: 'Nightly' })],
    }), `threw on ${JSON.stringify(access)}`);
  }
});

// ================================================================ logic/compareText.ts

const cmp = (a, b) => comparisonText(compareRuns(run(a), run(b)));

test('two runs of the same task get one heading and no cross-task caveat', () => {
  const md = cmp({ date: '2026-09-01T09:00:00' }, { date: '2026-09-02T09:00:00' });
  assert.match(md, /^# Nightly$/m);
  assert.doesNotMatch(md, /different scripts/);
  assert.doesNotMatch(md, /reads backwards in time/);
});

test('comparing different scripts, or backwards in time, says so', () => {
  const back = cmp({ date: '2026-09-05T09:00:00' }, { date: '2026-09-01T09:00:00' });
  assert.match(back, /the compared run is the OLDER of the two, so "changed" reads backwards in time/);

  const cross = cmp({ task: 'Alpha', date: '2026-09-01T09:00:00' }, { task: 'Beta', date: '2026-09-02T09:00:00' });
  assert.match(cross, /^# Alpha → Beta$/m);
  assert.match(cross, /metrics with the same name may not mean the same thing/);
});

test('a recovery and a break are called by name', () => {
  const recovered = cmp({ success: false, date: '2026-09-01T09:00:00' }, { success: true, date: '2026-09-02T09:00:00' });
  assert.match(recovered, /\*\*This run recovered\*\*/);

  const broke = cmp({ success: true, date: '2026-09-01T09:00:00' }, { success: false, date: '2026-09-02T09:00:00', category: 'timeout' });
  assert.match(broke, /\*\*This run broke\*\*/);
  assert.match(broke, /FAILED \(timeout\)/, 'the failure category rides along in the table');
});

test('the duration row states the direction and the size of the change', () => {
  const slower = cmp({ elapsed: 100, date: '2026-09-01T09:00:00' }, { elapsed: 150, date: '2026-09-02T09:00:00' });
  assert.match(slower, /slower by 50s \(\+50\.0%\)/);

  const faster = cmp({ elapsed: 100, date: '2026-09-01T09:00:00' }, { elapsed: 50, date: '2026-09-02T09:00:00' });
  assert.match(faster, /faster by 50s \(-50\.0%\)/);

  const same = cmp({ elapsed: 100, date: '2026-09-01T09:00:00' }, { elapsed: 100, date: '2026-09-02T09:00:00' });
  assert.doesNotMatch(same, /slower|faster/, 'no change, no claim');
});

test('a change from zero reports the delta but no percentage', () => {
  // 🔴 This test originally claimed to fence compareText's `!isFinite` guard. The mutation control
  // showed it could not: that guard is unreachable from compareRuns, which already returns null
  // rather than dividing by zero, so the test was passing on a different module's work and would
  // have stayed green if compareText's guard were deleted. What is actually worth pinning is the
  // upstream contract — nothing non-finite is ever handed to the formatter — so that is what it
  // says now, and the mutation that proves it lives in compare.ts.
  const dur = cmp({ elapsed: 0, date: '2026-09-01T09:00:00' }, { elapsed: 30, date: '2026-09-02T09:00:00' });
  assert.doesNotMatch(dur, /Infinity|NaN/);
  assert.match(dur, /slower by 30s \|/, 'the size of the change is still real and still reported');

  const metric = cmp(
    { date: '2026-09-01T09:00:00', metrics: { rows: 0 } },
    { date: '2026-09-02T09:00:00', metrics: { rows: 500 } },
  );
  assert.doesNotMatch(metric, /Infinity|NaN/, 'a percentage of zero is undefined, not infinite');
  assert.match(metric, /\| rows \| 0 \| 500 \| \+500 \|/, 'and the delta stands on its own');
});

test('every metric direction gets its own words', () => {
  const md = cmp(
    { date: '2026-09-01T09:00:00', metrics: { gone: 1, same: 5, up: 10, down: 10, text: 'a' } },
    { date: '2026-09-02T09:00:00', metrics: { fresh: 2, same: 5, up: 15, down: 5, text: 'b' } },
  );
  assert.match(md, /\| fresh \| — \| 2 \| new this run \|/);
  assert.match(md, /\| gone \| 1 \| — \| not reported this run \|/);
  assert.match(md, /\| same \| 5 \| 5 \| unchanged \|/);
  assert.match(md, /\| up \| 10 \| 15 \| \+5 \(\+50\.0%\) \|/);
  assert.match(md, /\| down \| 10 \| 5 \| -5 \(-50\.0%\) \|/);
  assert.match(md, /\| text \| a \| b \| changed \|/, 'two different strings have no delta, only a change');
});

test('no metrics at all is stated, not left blank', () => {
  const md = cmp({ date: '2026-09-01T09:00:00' }, { date: '2026-09-02T09:00:00' });
  assert.match(md, /_Neither run reported any metrics\._/);
  assert.doesNotMatch(md, /## Metrics/);
});

test('warnings are split into new, gone and still there', () => {
  const w = (...msgs) => msgs.map(msg => ({ msg }));
  const md = cmp(
    { date: '2026-09-01T09:00:00', warningItems: w('old one', 'persistent') },
    { date: '2026-09-02T09:00:00', warningItems: w('brand new', 'persistent') },
  );
  assert.match(md, /\*\*New \(1\)\*\*\n\n- brand new/);
  assert.match(md, /\*\*Gone \(1\)\*\*\n\n- old one/);
  assert.match(md, /\*\*Still there \(1\)\*\*\n\n- persistent/);
});

test('no warnings in either run is stated too', () => {
  const md = cmp({ date: '2026-09-01T09:00:00' }, { date: '2026-09-02T09:00:00' });
  assert.match(md, /## Warnings\n\n_Neither run recorded a warning\._/);
});

test('the Touched section appears only when something changed, and marks each direction', () => {
  const none = cmp(
    { date: '2026-09-01T09:00:00', accessed: ['file:a'] },
    { date: '2026-09-02T09:00:00', accessed: ['file:a'] },
  );
  assert.doesNotMatch(none, /## Touched/);

  const md = cmp(
    { date: '2026-09-01T09:00:00', accessed: ['file:a', 'file:dropped'] },
    { date: '2026-09-02T09:00:00', accessed: ['file:a', 'file:added'] },
  );
  assert.match(md, /## Touched/);
  assert.match(md, /- `\+` file:added/);
  assert.match(md, /- `−` file:dropped \(not this run\)/);
});

test('the document ends with exactly one newline', () => {
  // 🔴 This asserted the same thing on a fixture that could not show it. Every section that ends
  // in a blank line does so by pushing '', and the LAST such push is what trimEnd removes — so a
  // comparison with no warnings ends on a sentence and passes whether trimEnd runs or not. Only a
  // run that reaches a warnings sub-block ends on a blank. The mutation control caught it: with
  // the collapse and trimEnd both deleted, the old test stayed green.
  const w = (...msgs) => msgs.map(msg => ({ msg }));
  const withTrailingBlank = cmp(
    { date: '2026-09-01T09:00:00', warningItems: w('old') },
    { date: '2026-09-02T09:00:00', warningItems: w('new') },
  );
  assert.ok(withTrailingBlank.endsWith('\n'), 'a text file ends with a newline');
  assert.ok(!withTrailingBlank.endsWith('\n\n'), 'but not with a blank line — this gets pasted into tickets');
  assert.doesNotMatch(withTrailingBlank, /\n{3}/, 'and no gaps in the middle');
});

// ================================================================ render/impact.ts

const impactData = (impact, history = []) => ({
  progress: null, tasks: [], history, deltas: {}, impact, access: null, overlays: [],
  logsDir: 'C:/ws/logs', logsDirExists: true, readErrors: [],
});
const pt = (value, date, over = {}) => ({ date, value, task: 'Nightly', ...over });
const NOW = new Date('2026-09-07T10:00:00');

test('with nothing recorded, Impact explains how to record something', () => {
  const html = renderImpact(impactData({}), S(), NOW, {});
  // &quot; because the empty state goes through the same escaper as everything else — which is
  // the correct answer, and worth pinning so nobody "fixes" it by emitting raw quotes.
  assert.match(html, /Progress\.impact\(&quot;name&quot;, value\)/);
  assert.match(html, /a contribution to accumulate, as opposed to a current value to chart/);
  assert.doesNotMatch(html, /imp-card/);
});

test('a total states its runs, its recency and the source of its definition', () => {
  const html = renderImpact(impactData({
    rows: [pt(100, '2026-09-01T09:00:00'), pt(50, '2026-09-06T09:00:00')],
  }), S(), NOW, {});
  assert.match(html, /imp-card/);
  assert.match(html, /150/, 'the total is the sum');
  assert.match(html, /across 2 runs/);
  // 🔴 Not decoration: a self-reported total under its author's own definition is exactly the
  // number that gets quoted without its definition.
  assert.match(html, /Totals are what your scripts reported, using their own definition/);
});

test('one run reads "1 run", not "1 runs"', () => {
  const html = renderImpact(impactData({ rows: [pt(7, '2026-09-06T09:00:00')] }), S(), NOW, {});
  assert.match(html, /across 1 run\b/);
  assert.doesNotMatch(html, /across 1 runs/);
});

test('a month figure identical to the total is not printed twice', () => {
  const all = renderImpact(impactData({ rows: [pt(10, '2026-09-06T09:00:00')] }), S(), NOW, {});
  assert.doesNotMatch(all, /this month|nothing this month/, 'everything is from this month; saying so adds nothing');

  const split = renderImpact(impactData({
    rows: [pt(10, '2026-08-06T09:00:00'), pt(5, '2026-09-06T09:00:00')],
  }), S(), NOW, {});
  assert.match(split, /this month/);
});

test('a metric with nothing this month says so rather than showing a stale figure', () => {
  const html = renderImpact(impactData({
    rows: [pt(10, '2026-07-06T09:00:00'), pt(5, '2026-08-06T09:00:00')],
  }), S(), NOW, {});
  assert.match(html, /nothing this month/);
});

test('past 24 measures it stops and says how many it is not showing', () => {
  const many = {};
  for (let i = 0; i < 30; i++) many[`m${String(i).padStart(2, '0')}`] = [pt(i + 1, '2026-09-06T09:00:00')];
  const html = renderImpact(impactData(many), S(), NOW, {});
  assert.equal((html.match(/imp-card/g) || []).length, 24, '24 cards is already a wall');
  assert.match(html, /6 more measures not shown/);

  const one = {};
  for (let i = 0; i < 25; i++) one[`m${String(i).padStart(2, '0')}`] = [pt(1, '2026-09-06T09:00:00')];
  assert.match(renderImpact(impactData(one), S(), NOW, {}), /1 more measure not shown/, 'singular');
});

test('a contribution from a run that failed is not counted', () => {
  const history = [run({ runId: 'bad', success: false })];
  const html = renderImpact(impactData({
    rows: [pt(100, '2026-09-06T09:00:00', { runId: 'bad' }), pt(5, '2026-09-06T09:00:00', { runId: 'ok' })],
  }, history), S(), NOW, {});
  assert.match(html, /\b5\b/);
  assert.doesNotMatch(html, /105/, 'a failed run\'s contribution is not a contribution');
});

test('the metric label is escaped, because a script chose it', () => {
  const html = renderImpact(impactData({
    '<img src=x onerror=alert(1)>': [pt(1, '2026-09-06T09:00:00')],
  }), S(), NOW, {});
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img src=x/);
});
