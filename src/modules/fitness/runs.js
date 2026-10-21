// A run is the newest `reps` event plus the ones just before it for the same
// exercise, each within `gap` of the next. Undo cancels a whole run, so ten
// quick taps undo as one.
export const GAP = 60 * 1000;

// `events`: effective `reps` events, oldest first. Returns { exercise, n, ids, ts } or null.
export function lastRun(events, gap = GAP) {
  if (!events.length) return null;
  const newest = events[events.length - 1];
  const run = { exercise: newest.data.exercise, n: 0, ids: [], ts: newest.ts };
  let next = newest;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.data.exercise !== run.exercise || next.ts - e.ts > gap) break;
    run.n += e.data.n;
    run.ids.push(e.id);
    next = e;
  }
  return run;
}
