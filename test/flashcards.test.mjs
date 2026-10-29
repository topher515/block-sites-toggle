import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { replay, pickCard, available, questionKind, choices, INTERVALS, TYPED_FROM_BOX } from '../src/modules/flashcards/srs.js';
import { combine, deckStates, qid } from '../src/modules/flashcards/pool.js';
import { phoneCards, parseNumber, checkDigits } from '../src/modules/flashcards/phone.js';
import { check, normalize } from '../src/modules/flashcards/match.js';
import { favoriteFact, randomFact } from '../src/modules/flashcards/facts.js';

const deck = JSON.parse(fs.readFileSync(new URL('../src/modules/flashcards/decks/africa/deck.json', import.meta.url)));
const states50 = JSON.parse(fs.readFileSync(new URL('../src/modules/flashcards/decks/states/deck.json', import.meta.url)));
const card = (id) => deck.cards.find((c) => c.id === id);
const review = (cardId, result, ts) => ({ ts, data: { card: cardId, result, how: 'mc' } });
const MIN = 60_000;
const DAY = 24 * 60 * MIN;

test('africa deck has 54 unique countries, all on the map', () => {
  assert.equal(deck.cards.length, 54);
  assert.equal(new Set(deck.cards.map((c) => c.id)).size, 54);
  const svg = fs.readFileSync(new URL('../src/modules/flashcards/decks/africa/map.svg', import.meta.url), 'utf8');
  for (const c of deck.cards) assert.ok(svg.includes(`data-id="${c.id}"`), c.id);
});

test('africa deck: shape stories are text or null', () => {
  for (const c of deck.cards) {
    if (!('shape' in c)) continue;
    assert.ok(c.shape === null || (typeof c.shape === 'string' && c.shape.length > 40), c.id);
  }
});

test('replay: right moves up, wrong and dunno reset', () => {
  const s = replay([review('KE', 'right', 1), review('KE', 'right', 2), review('UG', 'right', 1), review('UG', 'dunno', 5)]);
  assert.equal(s.get('KE').box, 2);
  assert.equal(s.get('KE').due, 2 + INTERVALS[2]);
  assert.equal(s.get('UG').box, 0);
  assert.equal(s.get('UG').wrong, 1);
});

test('questionKind graduates to typing at TYPED_FROM_BOX', () => {
  assert.equal(questionKind(undefined), 'mc');
  assert.equal(questionKind({ box: TYPED_FROM_BOX - 1 }), 'mc');
  assert.equal(questionKind({ box: TYPED_FROM_BOX }), 'typed');
  assert.equal(questionKind({ box: 5 }, { typing: false }), 'mc');
});

test('pickCard prefers due cards, then new cards up to maxLearning', () => {
  const cards = deck.cards.slice(0, 10);
  const now = 10 * DAY;
  // One card wrong a while ago (due) -> it is picked.
  let states = replay([review(cards[0].id, 'wrong', now - 10 * MIN)]);
  assert.equal(pickCard(cards, states, now).id, cards[0].id);
  // ...but not straight after it was answered.
  states = replay([review(cards[0].id, 'wrong', now - 1)]);
  assert.notEqual(pickCard(cards, states, now).id, cards[0].id);
  // Learning slots full and nothing due -> practice a seen card (the one not just answered), not a new one.
  states = replay(cards.slice(0, 4).map((c, i) => review(c.id, 'right', now - 4 * MIN + i)));
  assert.equal(pickCard(cards, states, now, { maxLearning: 4 }).id, cards[0].id);
});

// Everything mastered, then two misses in a row. They used to alternate until both were back
// at mastered (multiple choice twice, typed twice, each) before any other card came up.
test('pickCard: misses among mastered cards come back spaced out, not drilled', () => {
  const t0 = 100 * DAY;
  const reviews = deck.cards.flatMap((c, i) =>
    [0, 1, 2, 3].map((k) => review(c.id, 'right', t0 - 2 * DAY - i * 20 * MIN + k))); // box 4, none due
  const shown = [];
  for (let i = 0; i < 40; i++) {
    const now = t0 + i * 10_000; // one answer every 10 s
    const c = pickCard(deck.cards, replay(reviews), now);
    reviews.push(review(c.id, i < 2 ? 'wrong' : 'right', now));
    shown.push(c.id);
  }
  const at = (id) => shown.flatMap((x, i) => (x === id ? [i] : []));
  // Missed at 0 and 1; back after 3 other cards; then each waits out its 5 minutes (30 cards).
  assert.deepEqual(at(shown[0]), [0, 4, 34]);
  assert.deepEqual(at(shown[1]), [1, 5, 35]);
});

test('choices: 4 unique options including the answer, same region first', () => {
  const ke = card('KE');
  const opts = choices(ke, deck.cards);
  assert.equal(opts.length, 4);
  assert.equal(new Set(opts.map((c) => c.id)).size, 4);
  assert.ok(opts.some((c) => c.id === 'KE'));
  assert.ok(opts.every((c) => c.group === ke.group));
});

test('typed answers: accents, aliases, typos', () => {
  assert.equal(normalize("  Côte d'Ivoire "), 'cote d ivoire');
  assert.ok(check('cote divoire', card('CI'), deck.cards).ok);
  assert.ok(check('Ivory Coast', card('CI'), deck.cards).exact);
  assert.ok(check('DRC', card('CD'), deck.cards).ok);
  assert.ok(check('Swaziland', card('SZ'), deck.cards).ok);
  assert.ok(check('Kenia', card('KE'), deck.cards).ok);
  assert.ok(check('Mozambqiue', card('MZ'), deck.cards).ok);
  assert.ok(!check('Kenyaaa', card('KE'), deck.cards).ok);
});

test('typed answers: naming a different country is wrong even if one letter off', () => {
  const r = check('Zambia', card('GM'), deck.cards);
  assert.equal(r.ok, false);
  assert.equal(r.other.id, 'ZM');
  assert.ok(!check('Niger', card('NG'), deck.cards).ok);
  assert.ok(!check('Sudan', card('SS'), deck.cards).ok);
  assert.ok(!check('Guinea', card('GQ'), deck.cards).ok);
});

test('africa deck: every country has at least three facts', () => {
  assert.equal(deck.wikipedia, true);
  for (const c of deck.cards) {
    assert.ok(Array.isArray(c.facts) && c.facts.length >= 3 && c.facts.every((f) => f.length > 10), c.id);
  }
});

test('favoriteFact: deck pick first, then the latest user pick that still exists', () => {
  const ke = card('KE');
  const pick = (fact, c = 'KE') => ({ data: { card: c, fact } });
  assert.equal(favoriteFact(ke, []), ke.facts[0]);
  assert.equal(favoriteFact(ke, [pick(ke.facts[2]), pick(ke.facts[1])]), ke.facts[1]);
  assert.equal(favoriteFact(ke, [pick(ke.facts[2]), pick('a fact since removed from the deck')]), ke.facts[2]);
  assert.equal(favoriteFact(ke, [pick(card('UG').facts[1], 'UG')]), ke.facts[0]);
});

test('randomFact never returns the favorite', () => {
  const ke = card('KE');
  for (const r of [0, 0.3, 0.6, 0.999]) assert.notEqual(randomFact(ke, ke.facts[0], () => r), ke.facts[0]);
  assert.equal(randomFact({ facts: ['only'] }, 'only'), null);
});

test('states deck has 50 unique states, all on the map', () => {
  assert.equal(states50.cards.length, 50);
  assert.equal(new Set(states50.cards.map((c) => c.id)).size, 50);
  const svg = fs.readFileSync(new URL('../src/modules/flashcards/decks/states/map.svg', import.meta.url), 'utf8');
  for (const c of states50.cards) assert.ok(svg.includes(`data-id="${c.id}"`), c.id);
  assert.ok(states50.cards.every((c) => c.group));
});

test('phone: 10 digits (or 1 + 10), split 3-3-4, whole number locked behind the parts', () => {
  assert.equal(parseNumber('(415) 555-0123'), '4155550123');
  assert.equal(parseNumber('+1 415 555 0123'), '4155550123');
  assert.equal(parseNumber('555-0123'), null);
  assert.deepEqual(phoneCards(''), []);
  const cards = phoneCards('415-555-0123', 'her number');
  assert.deepEqual(cards.map((c) => c.answer), ['415', '555', '0123', '(415) 555-0123']);
  assert.equal(cards[2].prompt, '(415) 555-____');
  assert.deepEqual(cards[3].requires, cards.slice(0, 3).map((c) => c.id));
  // A different number gets different ids, so it starts fresh.
  assert.notEqual(phoneCards('415-555-0124')[0].id, cards[0].id);
});

test('phone: typed digits must match exactly, punctuation ignored', () => {
  const [, , last, whole] = phoneCards('415-555-0123');
  assert.ok(checkDigits('0123', last).ok);
  assert.ok(!checkDigits('0124', last).ok);
  assert.ok(checkDigits('415.555.0123', whole).ok);
  assert.ok(checkDigits('1 415 555 0123', whole).ok);
  assert.ok(!checkDigits('', whole).ok);
});

test('available: a card with requires waits for them to reach typing, then stays', () => {
  const cards = phoneCards('4155550123');
  const [a, m, l, w] = cards.map((c) => c.id);
  const ups = (id, n, t = 0) => Array.from({ length: n }, (_, i) => review(id, 'right', t + i));
  assert.ok(!available(cards, replay([...ups(a, 2), ...ups(m, 2), ...ups(l, 1)])).some((c) => c.id === w));
  assert.ok(available(cards, replay([...ups(a, 2), ...ups(m, 2), ...ups(l, 2)])).some((c) => c.id === w));
  // Missing a part later doesn't re-lock the whole number once it has been asked.
  const later = replay([...ups(a, 2), ...ups(m, 2), ...ups(l, 2), review(w, 'right', 10), review(a, 'wrong', 11)]);
  assert.ok(available(cards, later).some((c) => c.id === w));
});

test('combine: decks keep their own ids and states, merged under deck:card', () => {
  const pool = combine([
    { id: 'africa', cards: deck.cards, reviews: [review('KE', 'right', 1)] },
    { id: 'phone', cards: phoneCards('4155550123'), reviews: [] },
  ]);
  assert.equal(pool.cards.length, 58);
  assert.equal(pool.states.get(qid('africa', 'KE')).box, 1);
  const whole = pool.cards.find((c) => c.deck === 'phone' && c.requires);
  assert.ok(whole.requires.every((id) => id.startsWith('phone:')));
  assert.deepEqual([...deckStates(pool.states, 'africa').keys()], ['KE']);
});

test('pickCard: new cards come from each deck evenly, and phone parts in order', () => {
  const pool = combine([
    { id: 'africa', cards: deck.cards, reviews: [] },
    { id: 'phone', cards: phoneCards('4155550123'), reviews: [] },
  ]);
  const cards = available(pool.cards, pool.states);
  assert.equal(pickCard(cards, pool.states, 0, { rand: () => 0 }).deck, 'africa');
  const p = pickCard(cards, pool.states, 0, { rand: () => 0.99 });
  assert.equal(p.deck, 'phone');
  assert.equal(p.answer, '415');
});
