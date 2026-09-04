const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { writeEvent, EVENT_FILE } = require('../out/eventFile.js');

test('event file is written atomically and replaced', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spd-ev-'));
  writeEvent(dir, { event: 'failed', task: 'T', at: '2026-09-04T10:00:00', elapsed: 5 });
  let d = JSON.parse(fs.readFileSync(path.join(dir, EVENT_FILE), 'utf-8'));
  assert.equal(d.event, 'failed'); assert.equal(d.task, 'T');
  writeEvent(dir, { event: 'complete', task: 'T', at: '2026-09-04T10:01:00' });
  d = JSON.parse(fs.readFileSync(path.join(dir, EVENT_FILE), 'utf-8'));
  assert.equal(d.event, 'complete');
  assert.deepEqual(fs.readdirSync(dir), [EVENT_FILE], 'no .tmp left behind');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('an unwritable folder never throws', () => {
  assert.doesNotThrow(() => writeEvent('\0bad', { event: 'failed', task: 'T', at: 'x' }));
});
