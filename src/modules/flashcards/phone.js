// A phone number as a tiny deck, built from settings so the number never lives in the repo.
// Pure.
//
// Cards: the area code, the middle three, the last four (in that order), then the whole
// number once all three are learned. Card ids carry a short hash of the number, so changing
// the number starts it fresh instead of reusing the old one's progress.

export const digits = (s) => String(s || '').replace(/\D/g, '');

// 10 digits, or 11 with a leading 1. Anything else is not a number we can drill.
export function parseNumber(s) {
  let d = digits(s);
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return d.length === 10 ? d : null;
}

function hash(s) {
  let h = 5381;
  for (const ch of s) h = ((h * 33) ^ ch.charCodeAt(0)) >>> 0;
  return h.toString(36);
}

const blank = (n) => '_'.repeat(n);
export const format = (d) => `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;

export function phoneCards(number, label = 'the number') {
  const d = parseNumber(number);
  if (!d) return [];
  const v = hash(d);
  const [area, mid, last] = [d.slice(0, 3), d.slice(3, 6), d.slice(6)];
  const id = (part) => `${part}-${v}`;
  return [
    { id: id('area'), seq: 1, answer: area, prompt: `(${blank(3)}) ${blank(3)}-${blank(4)}`, question: `Area code of ${label}` },
    { id: id('mid'), seq: 2, answer: mid, prompt: `(${area}) ${blank(3)}-${blank(4)}`, question: `Next three digits of ${label}` },
    { id: id('last'), seq: 3, answer: last, prompt: `(${area}) ${mid}-${blank(4)}`, question: `Last four digits of ${label}` },
    {
      id: id('whole'), seq: 4, answer: format(d), prompt: `(${blank(3)}) ${blank(3)}-${blank(4)}`,
      question: `All of ${label}`, requires: [id('area'), id('mid'), id('last')],
    },
  ];
}

// Typed-answer check for a phone card: the digits must match exactly (no typo tolerance).
export function checkDigits(input, card) {
  let said = digits(input);
  const want = digits(card.answer);
  if (want.length === 10 && said.length === 11 && said[0] === '1') said = said.slice(1);
  const ok = !!said && said === want;
  return { ok, exact: ok, other: null };
}
