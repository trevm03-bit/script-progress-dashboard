// Settings validation. The point of this module is that a malformed entry is REPORTED rather
// than silently dropped, so these tests care as much about "says something useful" as about
// "returns a non-empty array".
const test = require('node:test');
const assert = require('node:assert');
const { validateSettings, problemsFor, problemText } = require('../out/logic/validate');

test('valid settings produce no problems', () => {
  const p = validateSettings({
    buttons: [{ label: 'Run it', command: 'python x.py', confirm: true, icon: 'play' }],
    processes: [
      { name: 'Nightly', label: 'Nightly', frequency: 'daily' },
      { name: 'Close', label: 'Close', frequency: 'monthly', dayOfMonth: 5, maxMinutes: 30 },
      { name: 'Weekly', label: 'Weekly', frequency: 'weekly', dayOfWeek: 1 },
    ],
    deltaMetrics: ['drift'],
    deltaThresholds: { drift: { min: -5, max: 5 } },
  });
  assert.deepStrictEqual(p, []);
});

test('nothing configured is not a problem', () => {
  assert.deepStrictEqual(validateSettings({}), []);
  assert.deepStrictEqual(validateSettings({ buttons: [], processes: [] }), []);
});

test('a button without a command is reported against its label', () => {
  const p = problemsFor(validateSettings({ buttons: [{ label: 'Broken' }] }), 'quickActions');
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].index, 1);
  assert.strictEqual(p[0].label, 'Broken');
  assert.match(p[0].message, /command/);
});

test('a button without a label still reports its position', () => {
  const p = problemsFor(validateSettings({ buttons: [{ command: 'x' }, { label: 'ok', command: 'y' }] }), 'quickActions');
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].index, 1);
  assert.match(problemText(p[0]), /^Entry 1 needs a "label"/);
});

test('wrong types are described, not thrown on', () => {
  const p = validateSettings({ buttons: 'not a list', processes: [null, 42] });
  assert.match(problemsFor(p, 'quickActions')[0].message, /must be a list/);
  const proc = problemsFor(p, 'processCalendar');
  assert.strictEqual(proc.length, 2);
  assert.match(proc[0].message, /must be an object/);
});

test('a monthly process with no dayOfMonth can never be overdue, and says so', () => {
  const p = problemsFor(validateSettings({ processes: [{ name: 'Close', frequency: 'monthly' }] }), 'processCalendar');
  assert.strictEqual(p.length, 1);
  assert.match(p[0].message, /never be overdue/);
});

test('out-of-range calendar numbers are caught', () => {
  const p = problemsFor(validateSettings({
    processes: [
      { name: 'A', frequency: 'monthly', dayOfMonth: 41 },
      { name: 'B', frequency: 'weekly', dayOfWeek: 9 },
      { name: 'C', frequency: 'daily', dueHour: 25 },
      { name: 'D', frequency: 'daily', maxMinutes: -3 },
    ],
  }), 'processCalendar');
  assert.strictEqual(p.length, 4);
  assert.match(p[0].message, /1 to 31/);
  assert.match(p[1].message, /Sunday/);
  assert.match(p[2].message, /0 to 23/);
  assert.match(p[3].message, /positive/);
});

test('an unknown frequency names the value it found', () => {
  const p = problemsFor(validateSettings({ processes: [{ name: 'A', frequency: 'fortnightly' }] }), 'processCalendar');
  assert.match(p[0].message, /"fortnightly"/);
});

test('a threshold on an untracked metric is a no-op and is flagged', () => {
  const p = problemsFor(validateSettings({ deltaMetrics: ['a'], deltaThresholds: { b: { min: 0, max: 1 } } }), 'deltaTracker');
  assert.strictEqual(p.length, 1);
  assert.strictEqual(p[0].label, 'b');
  assert.match(p[0].message, /never charted/);
});

test('an inverted threshold makes every value out of range', () => {
  const p = problemsFor(validateSettings({ deltaMetrics: ['a'], deltaThresholds: { a: { min: 10, max: 1 } } }), 'deltaTracker');
  assert.strictEqual(p.length, 1);
  assert.match(p[0].message, /every value is out of range/);
});

test('problemsFor tolerates a missing list', () => {
  assert.deepStrictEqual(problemsFor(undefined, 'quickActions'), []);
});

test('problemText reads as a sentence', () => {
  const p = validateSettings({ buttons: [{ label: 'Deploy' }] })[0];
  assert.strictEqual(problemText(p), 'Entry 1 ("Deploy") needs a "command" — the shell command to run.');
});
