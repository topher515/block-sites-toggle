import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastRun, GAP } from '../src/modules/fitness/runs.js';

let seq = 0;
const reps = (exercise, n, ts) => ({ id: `e${++seq}`, ts, data: { exercise, n } });

test('lastRun: nothing logged', () => {
  assert.equal(lastRun([]), null);
});

test('lastRun: quick taps on one exercise add up', () => {
  const evs = [reps('pushup', 1, 0), reps('pushup', 5, 2000), reps('pushup', 1, 4000)];
  assert.deepEqual(lastRun(evs), { exercise: 'pushup', n: 7, ids: [evs[2].id, evs[1].id, evs[0].id], ts: 4000 });
});

test('lastRun: a pause longer than GAP starts a new run', () => {
  const evs = [reps('grip', 5, 0), reps('grip', 1, GAP + 1), reps('grip', 1, GAP + 1000)];
  const run = lastRun(evs);
  assert.equal(run.n, 2);
  assert.deepEqual(run.ids, [evs[2].id, evs[1].id]);
});

test('lastRun: another exercise ends the run', () => {
  const evs = [reps('pushup', 5, 0), reps('grip', 1, 1000), reps('pushup', 5, 2000)];
  const run = lastRun(evs);
  assert.equal(run.exercise, 'pushup');
  assert.equal(run.n, 5);
  assert.deepEqual(run.ids, [evs[2].id]);
});
