// DataReader tests against a temp folder: missing files, half-written files, last-good cache.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { DataReader } = require('../out/dataReader.js');
const fixture = require('./fixtures/data.json');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spd-reader-'));
}

test('missing folder and files give empty, well-typed data', () => {
  const dir = path.join(tmpDir(), 'nope');
  const r = new DataReader(dir);
  const d = r.readAll();
  assert.equal(d.progress, null);
  assert.deepEqual(d.history, []);
  assert.deepEqual(d.deltas, {});
  assert.equal(d.access, null);
  assert.equal(d.logsDirExists, false);
  assert.deepEqual(d.readErrors, []);
  assert.equal(r.latestMtime(), 0);
});

test('reads all four files and keeps the last good copy through a half-written file', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'progress.json'), JSON.stringify(fixture.progress));
  fs.writeFileSync(path.join(dir, 'run_history.json'), JSON.stringify(fixture.history));
  fs.writeFileSync(path.join(dir, 'deltas.json'), JSON.stringify(fixture.deltas));
  fs.writeFileSync(path.join(dir, 'access.json'), JSON.stringify(fixture.access));
  const r = new DataReader(dir);
  let d = r.readAll();
  assert.equal(d.progress.task, 'Demo Pipeline');
  assert.equal(d.history.length, 4);
  assert.equal(Object.keys(d.deltas).length, 2);
  assert.equal(d.access.nodes.length, 6);
  assert.ok(r.latestMtime() > 0);

  // Now a writer truncates progress.json mid-write.
  fs.writeFileSync(path.join(dir, 'progress.json'), '{"task": "Demo Pi');
  d = r.readAll();
  assert.equal(d.progress.task, 'Demo Pipeline');       // last good copy
  assert.equal(d.readErrors.length, 1);
  assert.match(d.readErrors[0], /progress\.json/);

  // Zero-length is silent (the normal moment between truncate and write).
  fs.writeFileSync(path.join(dir, 'progress.json'), '');
  d = r.readAll();
  assert.equal(d.progress.task, 'Demo Pipeline');
  assert.deepEqual(d.readErrors, []);

  // Deleted -> gone, and the cache is dropped.
  fs.unlinkSync(path.join(dir, 'progress.json'));
  d = r.readAll();
  assert.equal(d.progress, null);
});

test('malformed rows are filtered; wrong shapes are ignored', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'run_history.json'), JSON.stringify([{ task: 'ok', date: '2026-01-01' }, 'junk', null, { nope: 1 }]));
  fs.writeFileSync(path.join(dir, 'deltas.json'), JSON.stringify([1, 2, 3]));
  fs.writeFileSync(path.join(dir, 'access.json'), JSON.stringify({ nodes: 'nope' }));
  fs.writeFileSync(path.join(dir, 'progress.json'), JSON.stringify({ status: 'running' })); // no task
  const d = new DataReader(dir).readAll();
  assert.equal(d.history.length, 1);
  assert.deepEqual(d.deltas, {});
  assert.equal(d.access, null);
  assert.equal(d.progress, null);
});

test('setLogsDir clears the cache', () => {
  const a = tmpDir();
  const b = tmpDir();
  fs.writeFileSync(path.join(a, 'progress.json'), JSON.stringify(fixture.progress));
  const r = new DataReader(a);
  assert.equal(r.readAll().progress.task, 'Demo Pipeline');
  r.setLogsDir(b);
  assert.equal(r.readAll().progress, null);
});
