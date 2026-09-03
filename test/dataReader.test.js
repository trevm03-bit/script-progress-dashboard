// DataReader tests against a temp folder: missing files, half-written files, last-good cache,
// slot files, overlays.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DataReader } = require('../out/dataReader.js');
const fixture = require('./fixtures/data.json');

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'spd-reader-')); }
function write(dir, name, obj) { fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); fs.writeFileSync(path.join(dir, name), typeof obj === 'string' ? obj : JSON.stringify(obj)); }

test('missing folder and files give empty, well-typed data', () => {
  const dir = path.join(tmpDir(), 'nope');
  const r = new DataReader(dir);
  const d = r.readAll();
  assert.equal(d.progress, null);
  assert.deepEqual(d.tasks, []);
  assert.deepEqual(d.history, []);
  assert.deepEqual(d.deltas, {});
  assert.equal(d.access, null);
  assert.deepEqual(d.overlays, []);
  assert.equal(d.logsDirExists, false);
  assert.deepEqual(d.readErrors, []);
  assert.equal(r.latestMtime(), 0);
});

test('reads all files and keeps the last good copy through a half-written file', () => {
  const dir = tmpDir();
  write(dir, 'progress.json', fixture.progress);
  write(dir, 'run_history.json', fixture.history);
  write(dir, 'deltas.json', fixture.deltas);
  write(dir, 'access.json', fixture.access);
  const r = new DataReader(dir);
  let d = r.readAll();
  assert.equal(d.progress.task, 'Demo Pipeline');
  assert.equal(d.tasks.length, 1);        // main file counts as a task even without slots
  assert.equal(d.history.length, 4);
  assert.equal(Object.keys(d.deltas).length, 2);
  assert.equal(d.access.nodes.length, 6);
  assert.ok(r.latestMtime() > 0);

  write(dir, 'progress.json', '{"task": "Demo Pi');
  d = r.readAll();
  assert.equal(d.progress.task, 'Demo Pipeline');       // last good copy
  assert.equal(d.readErrors.length, 1);
  assert.match(d.readErrors[0], /progress\.json/);

  write(dir, 'progress.json', '');
  d = r.readAll();
  assert.equal(d.progress.task, 'Demo Pipeline');
  assert.deepEqual(d.readErrors, []);

  fs.unlinkSync(path.join(dir, 'progress.json'));
  d = r.readAll();
  assert.equal(d.progress, null);
  assert.deepEqual(d.tasks, []);
});

test('slot files: one card per task even when only one copy carries a runId', () => {
  const dir = tmpDir();
  write(dir, 'progress.json', { ...fixture.progress, runId: undefined, updatedAt: '2026-09-02T10:00:10' });
  write(dir, 'progress/demo-pipeline.json', { ...fixture.progress, runId: 'r1', updatedAt: '2026-09-02T10:00:20' });
  const d = new DataReader(dir).readAll();
  assert.equal(d.tasks.length, 1);
  assert.equal(d.tasks[0].runId, 'r1');                       // the newer copy won
});

test('slot files: concurrent tasks, running first, de-duplicated with the main file', () => {
  const dir = tmpDir();
  const a = { ...fixture.progress, task: 'A', runId: 'ra', updatedAt: '2026-09-02T10:00:20' };
  const b = { ...fixture.progress, task: 'B', runId: 'rb', updatedAt: '2026-09-02T10:00:22' };
  const c = { ...fixture.progress, task: 'C', runId: 'rc', status: 'complete', updatedAt: '2026-09-02T10:00:25' };
  write(dir, 'progress.json', b);                       // B wrote last
  write(dir, 'progress/a.json', a);
  write(dir, 'progress/b.json', { ...b, updatedAt: '2026-09-02T10:00:21' }); // older copy of B
  write(dir, 'progress/c.json', c);
  const d = new DataReader(dir).readAll();
  assert.deepEqual(d.tasks.map(t => t.task), ['B', 'A', 'C']);  // running newest-first, then finished
  assert.equal(d.tasks[0].updatedAt, '2026-09-02T10:00:22');     // the newer main copy won
  assert.equal(d.progress.task, 'B');
  assert.ok(new DataReader(dir).latestMtime() > 0);
});

test('overlays attach and are dropped when the task reports a final state', () => {
  const dir = tmpDir();
  write(dir, 'progress.json', fixture.progress);
  const r = new DataReader(dir);
  r.addOverlay({ task: 'Demo Pipeline', exitCode: 1, when: '2026-09-02T10:00:25' });
  r.addOverlay({ task: 'Demo Pipeline', exitCode: 3, when: '2026-09-02T10:00:26' }); // replaces
  let d = r.readAll();
  assert.equal(d.overlays.length, 1);
  assert.equal(d.overlays[0].exitCode, 3);
  write(dir, 'progress.json', { ...fixture.progress, status: 'failed' });
  d = r.readAll();
  assert.deepEqual(d.overlays, []);
  // An overlay that matches no task is dropped rather than kept forever.
  r.addOverlay({ task: 'Nobody', exitCode: 1, when: '2026-09-02T10:00:25' });
  assert.deepEqual(r.readAll().overlays, []);
});

test('malformed rows are filtered; wrong shapes are ignored', () => {
  const dir = tmpDir();
  write(dir, 'run_history.json', [{ task: 'ok', date: '2026-01-01' }, 'junk', null, { nope: 1 }]);
  write(dir, 'deltas.json', [1, 2, 3]);
  write(dir, 'access.json', { nodes: 'nope' });
  write(dir, 'progress.json', { status: 'running' }); // no task
  write(dir, 'progress/x.json', 'not json at all');
  const d = new DataReader(dir).readAll();
  assert.equal(d.history.length, 1);
  assert.deepEqual(d.deltas, {});
  assert.equal(d.access, null);
  assert.equal(d.progress, null);
  assert.deepEqual(d.tasks, []);
  assert.equal(d.readErrors.length, 1);
});

test('setLogsDir clears the cache and overlays', () => {
  const a = tmpDir();
  const b = tmpDir();
  write(a, 'progress.json', fixture.progress);
  const r = new DataReader(a);
  r.addOverlay({ task: 'Demo Pipeline', exitCode: 1, when: '2026-09-02T10:00:25' });
  assert.equal(r.readAll().progress.task, 'Demo Pipeline');
  r.setLogsDir(b);
  const d = r.readAll();
  assert.equal(d.progress, null);
  assert.deepEqual(d.overlays, []);
});
