const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { writeEvent, EVENT_FILE } = require('../out/eventFile.js');

test('event file is written atomically and replaced', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spd-ev-'));
  writeEvent(dir, { event: 'failed', task: 'T', at: '2026-09-04T10:00:00', elapsed: 5 }, true);
  let d = JSON.parse(fs.readFileSync(path.join(dir, EVENT_FILE), 'utf-8'));
  assert.equal(d.event, 'failed'); assert.equal(d.task, 'T');
  writeEvent(dir, { event: 'complete', task: 'T', at: '2026-09-04T10:01:00' }, true);
  d = JSON.parse(fs.readFileSync(path.join(dir, EVENT_FILE), 'utf-8'));
  assert.equal(d.event, 'complete');
  assert.deepEqual(fs.readdirSync(dir), [EVENT_FILE], 'no .tmp left behind');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an unwritable folder never throws', () => {
  // `trusted` passed explicitly. Omitting it left the argument undefined, i.e. falsy, so this
  // asserted that an UNTRUSTED write does not throw - which it cannot, because it never writes.
  // The case the test is named for was never exercised.
  assert.doesNotThrow(() => writeEvent('\0bad', { event: 'failed', task: 'T', at: 'x' }, true));
});

test('an untrusted workspace is never written to', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spd-ev-trust-'));
  writeEvent(dir, { event: 'failed', task: 'T', at: 'x' }, false);
  assert.deepEqual(fs.readdirSync(dir), [], 'settings from a cloned repo must not cause a write');
  fs.rmSync(dir, { recursive: true, force: true });
});
