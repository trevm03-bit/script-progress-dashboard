// The Settings object the PRODUCT builds from the defaults the PRODUCT ships, plus overrides.
//
// 🔴 This used to be a hand-written copy that claimed to mirror src/settings.ts and did not. It
// turned on all fifteen sections where the product ships nine, set `staleHours` to 24 where the
// product ships 168, and carried one interpreter where the product ships nine. So every render
// test exercised a configuration no installation has — and the DEFAULT configuration, the one
// almost every user runs, was the least-tested one. Four of the false positives the 2026-09-04
// review confirmed were only reachable because of it.
//
// It is now built by calling the real readSettings() against a `vscode` stub whose
// getConfiguration serves package.json's own declared defaults. The fixture cannot drift from the
// product, because it is the product reading its own manifest.
'use strict';
const path = require('path');
const { install } = require('./vscode-stub.js');

const repo = path.resolve(__dirname, '..', '..');
const pkg = require(path.join(repo, 'package.json'));

/** Every `scriptProgress.*` default, flattened out of the manifest's configuration groups. */
const groups = pkg.contributes.configuration;
const DECLARED = Object.assign({}, ...(Array.isArray(groups) ? groups : [groups]).map(g => g.properties || {}));

const vscode = install();
// readSettings() calls getConfiguration() itself, so the overrides for one build are parked here
// for the duration of that call rather than threaded through a signature we do not control.
let OVERRIDES = {};
vscode.workspace.getConfiguration = (section) => {
  const prefix = section ? `${section}.` : '';
  const declared = (key) => {
    const entry = DECLARED[`${prefix}${key}`];
    return entry ? entry.default : undefined;
  };
  return {
    // Deep-copied, because readSettings hands these straight into the Settings object and a test
    // that mutates one would otherwise poison every later call.
    get: (key, fallback) => {
      const v = Object.prototype.hasOwnProperty.call(OVERRIDES, key) ? OVERRIDES[key] : declared(key);
      return v === undefined ? fallback : JSON.parse(JSON.stringify(v));
    },
    // Defaults only: nothing here is user-set, which is exactly what a default fixture means.
    inspect: (key) => ({ key: `${prefix}${key}`, defaultValue: declared(key) }),
    update: () => Promise.resolve(),
  };
};

const { readSettings: realReadSettings } = require(path.join(repo, 'out/settings.js'));

/** Run the product's own settings reader with these raw `scriptProgress.*` values in place. */
function readSettings(overrides = {}) {
  OVERRIDES = overrides;
  try { return realReadSettings(); } finally { OVERRIDES = {}; }
}

/** Deep-merge overrides onto the shipped defaults, one level into plain objects. */
function merge(base, over) {
  const out = { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    const cur = out[k];
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur))
      ? { ...cur, ...v }
      : v;
  }
  return out;
}

// 🔴 Some overrides are not values the product passes through — they are inputs it TRANSFORMS,
// and merging them onto the finished object skips the transformation. `sectionOrder` is the one
// that bit: readSettings appends every unlisted section after the listed ones, so a test setting
// ['runHistory','summary'] should get seventeen entries and a result-merge gave it two. These go
// in as CONFIGURATION and come back through the real reader; everything else is pass-through and
// can be merged.
const CONFIG_KEYS = {
  sectionOrder: (v) => [['dashboard.sectionOrder', v]],
  sidebarSections: (v) => [['dashboard.sidebarSections', v]],
  sections: (v) => Object.entries(v).map(([id, on]) => [`sections.${id}`, on]),
  processes: (v) => [['processCalendar.processes', v]],
  buttons: (v) => [['quickActions.buttons', v]],
  deltaMetrics: (v) => [['deltaTracker.metrics', v]],
};

/**
 * A Settings object as the product would build it, with `o` applied.
 *
 * A test that needs a section the product ships OFF must say so: `S({ sections: { impact: true } })`.
 * That is the point — if a test needs a non-default configuration, the test should be the thing
 * that says which, rather than every test silently running one.
 */
function settings(o = {}) {
  const overrides = {};
  const rest = {};
  for (const [k, v] of Object.entries(o)) {
    if (CONFIG_KEYS[k] && v !== undefined) for (const [ck, cv] of CONFIG_KEYS[k](v)) overrides[ck] = cv;
    else rest[k] = v;
  }
  const s = merge(readSettings(overrides), rest);
  // The pure renderers take `problems` from settings; readSettings computes it from the same
  // inputs, so a test only supplies its own when the problems ARE the subject.
  if (o.problems) s.problems = o.problems;
  return s;
}

/** Every section switched on, for the tests whose subject is the full page. */
settings.allSections = (o = {}) => {
  const s = settings(o);
  s.sections = Object.fromEntries(Object.keys(s.sections).map(id => [id, true]));
  if (o.sections) Object.assign(s.sections, o.sections);
  return s;
};

/**
 * The demo configuration: every section on, plus the example processes and buttons the old
 * hand-written fixture supplied to every test whether it wanted them or not.
 *
 * Kept for the suites whose subject IS the full page. The difference from before is that a test
 * now has to ASK for it, so a test that does not ask exercises what users actually run.
 */
settings.demo = (o = {}) => settings.allSections({
  processes: [
    { name: 'Demo Pipeline', label: 'Demo', frequency: 'daily' },
    { name: 'Weekly Rollup', label: 'Weekly', frequency: 'weekly' },
    { name: 'Month-End Close', label: 'Close', frequency: 'monthly', dayOfMonth: 5 },
  ],
  buttons: [
    { label: 'Run <it>', command: 'python x.py --m ${prompt:Month}', icon: 'play', group: 'Ops', task: 'Demo Pipeline' },
    { label: 'No confirm', command: 'echo hi', confirm: false },
  ],
  ...o,
});

/** Section ids, in the order the manifest declares them. */
const ALL = Object.keys(settings().sections);

module.exports = { settings, ALL, DECLARED };
