// One queue across several decks. Pure.
//
// Each deck keeps its own review log (namespace `flashcards-<deck>`) with plain card ids.
// For scheduling they're merged under qualified ids, "<deck>:<card>", so pickCard can
// compare every card from every deck at once.
import { replay } from './srs.js';

export const qid = (deckId, cardId) => `${deckId}:${cardId}`;

// decks: [{ id, cards, reviews }] -> { cards, states }
//   cards: copies with qualified `id`, plus `deck` and `cardId`
//   states: Map of qualified id -> replay() state
export function combine(decks) {
  const cards = [];
  const states = new Map();
  for (const d of decks) {
    for (const c of d.cards) {
      cards.push({ ...c, id: qid(d.id, c.id), deck: d.id, cardId: c.id, requires: c.requires?.map((r) => qid(d.id, r)) });
    }
    for (const [id, s] of replay(d.reviews)) states.set(qid(d.id, id), s);
  }
  return { cards, states };
}

// One deck's states, by its own card ids, out of the combined map.
export function deckStates(states, deckId) {
  const prefix = `${deckId}:`;
  return new Map([...states].filter(([id]) => id.startsWith(prefix)).map(([id, s]) => [id.slice(prefix.length), s]));
}
