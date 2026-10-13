// Forgiving typed-answer checking. Pure.

export function normalize(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/^the /, '');
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

const names = (card) => [card.answer, ...(card.aliases || [])].map(normalize);

function tolerance(target) {
  if (target.length >= 10) return 2;
  if (target.length >= 5) return 1;
  return 0;
}

// Returns { ok, exact, other }.
//   ok:    accepted as this card's answer
//   exact: no typo
//   other: the card it exactly names instead, if any ("Zambia" for Gambia is wrong, not a typo)
export function check(input, card, allCards = []) {
  const said = normalize(input);
  if (!said) return { ok: false, exact: false, other: null };
  if (names(card).includes(said)) return { ok: true, exact: true, other: null };

  const other = allCards.find((c) => c.id !== card.id && names(c).includes(said)) || null;
  if (other) return { ok: false, exact: false, other };

  const close = names(card).some((n) => levenshtein(said, n) <= tolerance(n));
  return { ok: close, exact: false, other: null };
}
