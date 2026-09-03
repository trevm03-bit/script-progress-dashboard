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
  assert.ok(fs.existsSync(path.join(dir, 'progress', 'node-job.json')));
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
