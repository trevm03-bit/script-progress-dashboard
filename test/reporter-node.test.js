// The Node reporter writes the same contract as the Python one.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Progress, resolveLogsDir } = require('../reporters/progress.js');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'spd-node-')); }
const read = (dir, name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));

test('full run writes progress, slot, history, deltas, access', async () => {
  const dir = tmpDir();
  await Progress.run('Node Job', async p => {
    p.step(1, 2, 'Reading'); p.detail('12 rows'); p.substep(0.5); p.log('hello'); p.warn('one warning');
    p.access('file', 'in.csv'); p.access('table', 't.out', 'write'); p.metric('rows', 12); p.artifact('out.csv'); p.trackDelta('rows', 12);
    p.step(2, 2, 'Writing');
    p.complete(true, 'done', { extra: 'x' });
  }, dir);
  const prog = read(dir, 'progress.json');
  assert.equal(prog.status, 'complete');
  assert.equal(prog.metrics.rows, 12);
  assert.equal(prog.metrics.extra, 'x');
  assert.deepEqual(prog.accessed, ['file:in.csv', 'table:t.out']);
  assert.ok(prog.runId && prog.startedAt);
  // The slot name is now <readable>-<sha1 tag>, matching python/progress.py. The readable part
  // is only a hint; the hash is what stops two task names sharing one slot.
  const slots = fs.readdirSync(path.join(dir, 'progress'));
  assert.equal(slots.length, 1);
  assert.match(slots[0], /^node-job-[0-9a-f]{8}\.json$/, `slot was ${slots[0]}`);
  const hist = read(dir, 'run_history.json');
  assert.equal(hist.length, 1);
  assert.equal(hist[0].warnings, 1);
  assert.equal(hist[0].warningItems[0].msg, 'one warning');
  assert.deepEqual(hist[0].artifacts, ['out.csv']);
  assert.equal(read(dir, 'deltas.json').rows[0].value, 12);
  const g = read(dir, 'access.json');
  assert.equal(g.nodes.length, 3);
  assert.equal(g.edges.find(e => e.to === 'table:t.out').mode, 'write');
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.tmp')), []);
});

// 🔴 "Same file contract as python/progress.py" was a comment in the header, not something any
// test checked - and it silently stopped being true. The 1.6 slug fix, the history lock and the
// trackDelta guards all went into the Python reporter only, while this one kept being offered
// beside it in the same "Open the reporter" picker. These three tests make the claim falsifiable.
test('slot names match the Python reporter exactly, for names that used to collide', () => {
  const { execFileSync } = require('child_process');
  const names = ['Nightly Load', 'Nightly-Load', 'NIGHTLY_LOAD', '夜間ロード', 'Отчёт', '📊', ''];
  const dir = tmpDir();
  const fromNode = names.map(n => {
    const d = fs.mkdtempSync(path.join(dir, 'n-'));
    new Progress(n, d, { quiet: true });
    return fs.readdirSync(path.join(d, 'progress'))[0];
  });
  // Ask the Python reporter for the same names rather than reimplementing the rule here; a test
  // that repeats the implementation cannot notice the two drifting apart.
  const script = 'import json,sys; sys.path.insert(0, sys.argv[1]);\n'
    + 'from progress import _slug\n'
    + 'print(json.dumps([_slug(n) + ".json" for n in json.loads(sys.argv[2])]))';
  const out = execFileSync('python', ['-c', script, path.join(__dirname, '..', 'python'), JSON.stringify(names)],
    { encoding: 'utf8' });
  assert.deepEqual(fromNode, JSON.parse(out));
  // And the whole point: the three spellings of one name no longer share a slot, and the two
  // non-ASCII names no longer both land on 'task'.
  assert.equal(new Set(fromNode).size, names.length, `slots collided: ${fromNode}`);
});

test('trackDelta refuses a measurement that was never taken', () => {
  const dir = tmpDir();
  const p = new Progress('Guards', dir, { quiet: true });
  // Number(null), Number('') and Number(undefined) would be 0 or NaN. A zero on a reconciliation
  // series reads as "the discrepancy is fully resolved"; a NaN is written as null, which violates
  // deltas.schema.json and is then dropped by DataReader with no message.
  for (const bad of [null, undefined, '', 'n/a', NaN, Infinity, -Infinity]) p.trackDelta('drift', bad);
  assert.equal(fs.existsSync(path.join(dir, 'deltas.json')), false, 'a non-measurement was recorded');
  p.trackDelta('drift', '26.5');           // a numeric string is still a real reading
  p.trackDelta('drift', 0);                // and so is a genuine zero
  const series = read(dir, 'deltas.json').drift;
  assert.deepEqual(series.map(x => x.value), [26.5, 0]);
  assert.ok(series[0].runId, 'points carry the run id, as the Python reporter does');
});

test('concurrent completions all get recorded, and leave no lock behind', () => {
  const { execFileSync } = require('child_process');
  const dir = tmpDir();
  const worker = path.join(dir, 'w.js');
  fs.writeFileSync(worker, `
    const { Progress } = require(${JSON.stringify(path.join(__dirname, '..', 'reporters', 'progress.js'))});
    const release = Number(process.argv[2]);
    const p = new Progress('Task' + process.argv[3], process.argv[4], { quiet: true });
    while (Date.now() < release) { /* spin to the shared barrier so they really collide */ }
    p.trackDelta('series' + process.argv[3], Number(process.argv[3]));
    p.complete(true, 'done');
  `, 'utf8');
  const release = Date.now() + 2000;
  const kids = [];
  for (let i = 0; i < 6; i++) {
    kids.push(require('child_process').spawn(process.execPath, [worker, String(release), String(i), dir],
      { stdio: 'ignore' }));
  }
  const done = new Promise(res => {
    let left = kids.length;
    for (const k of kids) k.on('exit', () => { if (--left === 0) res(); });
  });
  return done.then(() => {
    // Unlocked, this shape lost 50-69% of rows - and in a mixed fleet it clobbered rows a Python
    // process had written while holding the lock this reporter never took.
    assert.equal(read(dir, 'run_history.json').length, 6, 'history rows lost to the completion race');
    assert.equal(Object.keys(read(dir, 'deltas.json')).length, 6, 'delta series lost to the race');
    assert.deepEqual(fs.readdirSync(dir).filter(f => f.endsWith('.lock')), []);
  });
});

test('a throw inside run is reported as FAILED and re-thrown', async () => {
  const dir = tmpDir();
  await assert.rejects(Progress.run('Crash', async () => { throw new Error('boom'); }, dir), /boom/);
  const prog = read(dir, 'progress.json');
  assert.equal(prog.status, 'failed');
  assert.match(prog.detail, /boom/);
  assert.equal(read(dir, 'run_history.json')[0].success, false);
});

test('eta from prior runs; logs dir resolution', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'run_history.json'), JSON.stringify([{ task: 'E', date: '2026-01-01', success: true, elapsed: 100 }, { task: 'E', date: '2026-01-02', success: true, elapsed: 200 }]));
  const p = new Progress('E', dir, { quiet: true });
  assert.ok(Math.abs(read(dir, 'progress.json').eta - 150) < 2);
  p.complete();
  assert.equal(resolveLogsDir('/x/logs'), '/x/logs');
  const proj = tmpDir();
  fs.mkdirSync(path.join(proj, '.git'));
  fs.mkdirSync(path.join(proj, 'scripts', 'lib'), { recursive: true });
  assert.equal(resolveLogsDir(undefined, path.join(proj, 'scripts', 'lib', 'progress.js')), path.join(proj, 'logs'));
});
