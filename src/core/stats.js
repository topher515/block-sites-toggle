// Pure helpers for turning an event list into numbers. No chrome APIs here.

const DAY = 24 * 60 * 60 * 1000;

// Local midnight `daysAgo` days before `now`.
export function startOfDay(now = Date.now(), daysAgo = 0) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d.getTime();
}

// Drop `undo` events and the events they point at.
export function effective(events) {
  const undone = new Set(events.filter((e) => e.type === 'undo').map((e) => e.data && e.data.target));
  return events.filter((e) => e.type !== 'undo' && !undone.has(e.id));
}

// Sum `valueFn(event)` over today, the last 7 days (including today) and ever.
export function tally(events, valueFn = () => 1, now = Date.now()) {
  const today = startOfDay(now);
  const week = startOfDay(now, 6);
  const out = { today: 0, week: 0, ever: 0 };
  for (const e of events) {
    const v = Number(valueFn(e)) || 0;
    out.ever += v;
    if (e.ts >= week) out.week += v;
    if (e.ts >= today) out.today += v;
  }
  return out;
}

// Count events per key, e.g. bounces per host. Returns [[key, n], ...] sorted desc.
export function countBy(events, keyFn) {
  const m = new Map();
  for (const e of events) {
    const k = keyFn(e);
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

export { DAY };
