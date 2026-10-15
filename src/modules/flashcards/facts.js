// "Most interesting fact" per card. card.facts[0] is the deck's pick; the user can replace it
// with any other fact via a `fact_pick` event: { card, fact } (the fact's text, so reordering
// or adding facts to the deck doesn't change what was picked).

// picks: fact_pick events, oldest first. The latest pick that still exists in the deck wins.
export function favoriteFact(card, picks) {
  const facts = card.facts || [];
  let fav = facts[0] ?? null;
  for (const e of picks) {
    if (e.data.card === card.id && facts.includes(e.data.fact)) fav = e.data.fact;
  }
  return fav;
}

// A random fact other than the favorite, or null if there isn't one.
export function randomFact(card, fav, rand = Math.random) {
  const others = (card.facts || []).filter((f) => f !== fav);
  return others.length ? others[Math.floor(rand() * others.length)] : null;
}
