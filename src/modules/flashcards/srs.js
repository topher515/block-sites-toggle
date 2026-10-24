// Leitner-style scheduling, derived entirely from `review` events. Pure.
//
// review event data: { card, result: 'right'|'wrong'|'dunno', how: 'mc'|'typed' }
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

// How long until a card in box N is due again.
export const INTERVALS = [0, 5 * MIN, 60 * MIN, DAY, 4 * DAY, 10 * DAY, 30 * DAY];
export const MAX_BOX = INTERVALS.length - 1;
// Cards at this box or higher are asked as typed answers (if typing is on).
export const TYPED_FROM_BOX = 2;
// The last RECENT_CARDS cards answered in the past RECENT_MS are held back, so a missed card
// comes back after a few others instead of straight away.
export const RECENT_CARDS = 3;
const RECENT_MS = 5 * MIN;

export function replay(reviews) {
  const states = new Map();
  for (const e of [...reviews].sort((a, b) => a.ts - b.ts)) {
    const { card, result } = e.data;
    const s = states.get(card) || { box: 0, right: 0, wrong: 0, last: 0, due: 0 };
    if (result === 'right') {
      s.box = Math.min(MAX_BOX, s.box + 1);
      s.right++;
    } else {
      s.box = 0;
      s.wrong++;
    }
    s.last = e.ts;
    s.due = e.ts + INTERVALS[s.box];
    states.set(card, s);
  }
  return states;
}

export function questionKind(state, { typing = true } = {}) {
  return typing && state && state.box >= TYPED_FROM_BOX ? 'typed' : 'mc';
}

// Choose the next card, skipping the ones just answered (RECENT_CARDS):
//   1. due cards, lowest box first, then most overdue
//   2. a new card, if fewer than `maxLearning` cards are still in multiple-choice boxes
//   3. otherwise practice ahead: the card due soonest among those on day-or-longer intervals.
//      A card on a same-day step (5 min, 1 hour) waits for it rather than being pulled forward
//      and drilled back up to mastered; it's practiced early only if nothing else is seen.
export function pickCard(cards, states, now, { maxLearning = 6, rand = Math.random } = {}) {
  const recent = [...states]
    .filter(([, s]) => now - s.last < RECENT_MS)
    .sort((a, b) => b[1].last - a[1].last)
    .slice(0, Math.min(RECENT_CARDS, cards.length - 1))
    .map(([id]) => id);
  const pool = cards.filter((c) => !recent.includes(c.id));
  const seen = pool.filter((c) => states.has(c.id));
  const byDue = (a, b) => states.get(a.id).due - states.get(b.id).due;

  const due = seen
    .filter((c) => states.get(c.id).due <= now)
    .sort((a, b) => states.get(a.id).box - states.get(b.id).box || byDue(a, b));
  if (due.length) return due[0];

  const learning = [...states.values()].filter((s) => s.box < TYPED_FROM_BOX).length;
  const fresh = pool.filter((c) => !states.has(c.id));
  if (fresh.length && learning < maxLearning) return fresh[Math.floor(rand() * fresh.length)];

  const ahead = seen.filter((c) => INTERVALS[states.get(c.id).box] >= DAY);
  if (ahead.length) return ahead.sort(byDue)[0];
  if (seen.length) return seen.sort(byDue)[0];
  return pool[Math.floor(rand() * pool.length)];
}

// Multiple-choice options: the answer plus distractors, preferring the same group.
export function choices(card, cards, n = 4, rand = Math.random) {
  const shuffle = (arr) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const others = cards.filter((c) => c.id !== card.id);
  const same = shuffle(others.filter((c) => card.group && c.group === card.group));
  const rest = shuffle(others.filter((c) => !card.group || c.group !== card.group));
  return shuffle([card, ...[...same, ...rest].slice(0, n - 1)]);
}

export function deckProgress(cards, states) {
  let learned = 0;
  let mastered = 0;
  for (const c of cards) {
    const s = states.get(c.id);
    if (s && s.box >= TYPED_FROM_BOX) learned++;
    if (s && s.box >= 4) mastered++;
  }
  return { total: cards.length, seen: [...states.keys()].length, learned, mastered };
}
