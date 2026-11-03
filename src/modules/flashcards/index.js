// Memorization: one flashcard queue across every enabled deck in decks.js.
// Each answer is a `review` event in the deck's own namespace (see decks.js):
//   { card, result: 'right'|'wrong'|'dunno', how: 'mc'|'typed' }
// Choosing a card's most interesting fact is a `fact_pick` event there too (see facts.js).
// Scheduling (srs.js, merged across decks by pool.js) is recomputed from those events every time.
import { h, useCss } from '../../core/dom.js';
import { DECKS, namespace } from './decks.js';
import { pickCard, available, questionKind, choices, deckProgress, TYPED_FROM_BOX } from './srs.js';
import { combine, deckStates } from './pool.js';
import { check } from './match.js';
import { favoriteFact, randomFact } from './facts.js';
import { parseNumber } from './phone.js';

const jsonCache = new Map();
function loadJson(ctx, deckId) {
  if (!jsonCache.has(deckId)) {
    jsonCache.set(deckId, fetch(ctx.assetUrl(`decks/${deckId}/deck.json`)).then((r) => r.json()));
  }
  return jsonCache.get(deckId);
}

const enabled = (settings) => DECKS.filter((meta) => settings.decks?.[meta.id] !== false);

// The enabled decks with their cards: [{ meta, deck, byId }]. A settings-built deck with no
// cards (no phone number yet) is left out.
async function loadDecks(ctx) {
  const out = [];
  for (const meta of enabled(ctx.settings)) {
    const deck = meta.cards ? meta.cards(ctx.settings) : await loadJson(ctx, meta.id);
    if (deck.cards.length) out.push({ meta, deck, byId: new Map(deck.cards.map((c) => [c.id, c])) });
  }
  return out;
}

// Every enabled deck's events of one type, by deck id.
async function eventsByDeck(ctx, decks, type) {
  const lists = await Promise.all(decks.map((d) => ctx.eventsOf(namespace(d.meta.id))));
  return new Map(decks.map((d, i) => [d.meta.id, lists[i].filter((e) => e.type === type)]));
}

async function snapshot(ctx, decks) {
  const reviews = await eventsByDeck(ctx, decks, 'review');
  const pool = combine(decks.map((d) => ({ id: d.meta.id, cards: d.deck.cards, reviews: reviews.get(d.meta.id) })));
  const since = ctx.stats.startOfDay(ctx.now());
  pool.today = [...reviews.values()].flat().filter((e) => e.ts >= since).length;
  return pool;
}

function textRenderer(stage) {
  const box = h('div', { class: 'fc-text num' });
  stage.replaceChildren(box);
  return {
    show(card) { box.textContent = card.prompt || card.id; },
    reveal() {},
  };
}

// What to show about a card after it's answered: why it has that shape or name (card.shape,
// null when there's no good story), the most interesting fact, one random other fact (which
// the user can promote to most interesting), and a Wikipedia link.
// The facts take up too much room next to the shape text; hidden for now, data and picks kept.
const SHOW_FACTS = false;

function cardInfo(deck, card, { fav, other, onPick }) {
  if (!SHOW_FACTS) fav = other = null;
  const wiki = deck.wikipedia ? card.wiki || card.answer.replaceAll(' ', '_') : null;
  return [
    card.shape && h('p', { class: 'fc-shape' }, h('span', { class: 'fc-fact-label' }, 'Why it looks like this'), card.shape),
    fav && h('p', { class: 'fc-fact fc-fav' }, h('span', { class: 'fc-fact-label' }, '★ Most interesting'), fav),
    other && h('p', { class: 'fc-fact' }, h('span', { class: 'fc-fact-label' }, 'Did you know?'), other,
      h('button', { class: 'ghost small fc-pick', title: 'Make this the most interesting fact', onclick: () => onPick(other) }, '★ More interesting')),
    wiki && h('a', { href: `https://en.wikipedia.org/wiki/${encodeURIComponent(wiki)}`, target: '_blank', rel: 'noopener', class: 'small' },
      `${card.answer} on Wikipedia ↗`),
  ];
}

export default {
  id: 'memorize',
  title: 'Memorization 🧠',
  description: 'Flashcards from every deck you turn on, spaced out so you remember them.',
  order: 20,
  category: 'memorization',
  aliases: DECKS.map((d) => namespace(d.id)), // the old one-mode-per-deck ids
  defaultSettings: {
    decks: Object.fromEntries(DECKS.map((d) => [d.id, true])),
    phoneLabel: 'her number',
    phoneNumber: '', // set on the options page; never committed
    typing: true,     // graduate cards to typed answers
    maxLearning: 6,   // how many cards each deck can have in the multiple-choice stage at once
  },

  async mount(el, ctx) {
    useCss(ctx.assetUrl('flashcards.css'));
    const decks = await loadDecks(ctx);
    const phoneMissing = ctx.settings.decks?.phone !== false && !parseNumber(ctx.settings.phoneNumber);
    if (!decks.length) {
      el.replaceChildren(h('div', { class: 'panel stack', style: { textAlign: 'center', marginTop: '10vh' } },
        h('h2', {}, 'No decks to practice'),
        h('p', { class: 'muted' }, phoneMissing
          ? 'Add the phone number, or turn on another deck, in Options.'
          : 'Turn on a deck in Options.')));
      return;
    }
    const byDeck = new Map(decks.map((d) => [d.meta.id, d]));

    const stage = h('div', { class: 'fc-stage' });
    const prompt = h('h2', { class: 'fc-prompt' });
    const answerArea = h('div', { class: 'fc-answer' });
    const feedback = h('div', { class: 'fc-feedback', 'aria-live': 'polite' });
    const info = h('div', { class: 'fc-info' });
    const progress = h('p', { class: 'fc-progress muted small num' });
    const note = phoneMissing && h('p', { class: 'muted small' }, 'Add the phone number in Options to practice it too.');
    el.replaceChildren(h('div', { class: 'fc' }, stage, prompt, answerArea, feedback, info, progress, ...(note ? [note] : [])));

    // One pane per deck, made the first time that deck comes up, so a map loads once.
    const panes = new Map();
    async function pane(d) {
      if (!panes.has(d.meta.id)) {
        const box = h('div', { class: 'fc-pane' });
        stage.append(box);
        const assetUrl = (rel) => ctx.assetUrl(`decks/${d.meta.id}/${rel}`);
        const renderer = d.meta.renderer ? await (await d.meta.renderer()).create(box, { assetUrl }) : textRenderer(box);
        panes.set(d.meta.id, { box, renderer });
      }
      for (const [id, p] of panes) p.box.hidden = id !== d.meta.id;
      return panes.get(d.meta.id).renderer;
    }

    let current = null; // { d, card, kind, renderer, answered }
    // Space acts on keydown, but a focused button clicks on Space keyup, and focus lands on
    // "Another" right after answering. Swallow that keyup so one press doesn't skip a card.
    let swallowSpaceUp = false;
    const takeSpace = (e) => { e.preventDefault(); swallowSpaceUp = true; };

    function updateProgress(d, pool) {
      const p = deckProgress(d.deck.cards, deckStates(pool.states, d.meta.id));
      progress.textContent =
        `${d.meta.title}: seen ${p.seen}/${p.total} · typing ${p.learned} · mastered ${p.mastered} · ${pool.today} answered today`;
    }

    async function ask() {
      const pool = await snapshot(ctx, decks);
      const q = pickCard(available(pool.cards, pool.states), pool.states, ctx.now(), { maxLearning: ctx.settings.maxLearning });
      const d = byDeck.get(q.deck);
      const card = d.byId.get(q.cardId);
      const kind = d.meta.typedOnly ? 'typed' : questionKind(pool.states.get(q.id), ctx.settings);
      const renderer = await pane(d);
      current = { d, card, kind, renderer, answered: false };
      renderer.show(card);
      prompt.textContent = card.question || d.deck.prompt;
      feedback.replaceChildren();
      feedback.className = 'fc-feedback';
      info.replaceChildren();

      const dunno = h('button', { class: 'ghost fc-dunno', onclick: () => answer('dunno', kind) }, "I don't know");
      if (kind === 'mc') {
        const opts = choices(card, d.deck.cards);
        answerArea.replaceChildren(
          h('div', { class: 'fc-choices' },
            opts.map((c, i) =>
              h('button', { class: 'fc-choice', 'data-key': i + 1, onclick: () => answer(c.id === card.id ? 'right' : 'wrong', 'mc', { picked: c.id }) },
                h('span', { class: 'fc-key' }, i + 1), c.answer))),
          h('div', { class: 'row fc-sub' }, dunno, h('span', { class: 'muted small' }, 'Keys: 1–4, Space or 0 = don’t know')),
        );
      } else {
        const numeric = !!d.meta.check;
        const input = h('input', {
          type: 'text', class: 'fc-input', placeholder: numeric ? 'Type the digits' : 'Type the answer',
          autocomplete: 'off', spellcheck: 'false', ...(numeric ? { inputmode: 'numeric' } : {}),
        });
        const submit = () => {
          if (!input.value.trim()) return;
          const res = (d.meta.check || check)(input.value, card, d.deck.cards);
          answer(res.ok ? 'right' : 'wrong', 'typed', { typed: input.value, exact: res.exact, other: res.other });
        };
        input.addEventListener('keydown', (e) => {
          e.stopPropagation(); // keep the page-level Enter = "Another" from firing too
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') answer('dunno', 'typed');
          if (e.key === ' ' && !input.value.trim()) { takeSpace(e); answer('dunno', 'typed'); }
        });
        answerArea.replaceChildren(
          h('div', { class: 'row fc-typed' }, input, h('button', { class: 'primary', onclick: submit }, 'Check')),
          h('div', { class: 'row fc-sub' }, dunno, h('span', { class: 'muted small' }, 'Enter = check, Esc or Space (empty box) = don’t know')),
        );
        input.focus();
      }
      updateProgress(d, pool);
    }

    async function answer(result, how, extra = {}) {
      if (!current || current.answered) return;
      current.answered = true;
      const { d, card, renderer } = current;
      const ns = namespace(d.meta.id);
      await ctx.logIn(ns, 'review', { card: card.id, result, how });
      renderer.reveal(card, { picked: extra.picked });

      answerArea.querySelectorAll('button, input').forEach((b) => (b.disabled = true));
      answerArea.querySelectorAll('.fc-choice').forEach((b) => {
        const opt = b.lastChild.textContent;
        if (opt === card.answer) b.classList.add('right');
        else if (extra.picked && d.byId.get(extra.picked)?.answer === opt) b.classList.add('wrong');
      });

      const pool = await snapshot(ctx, decks);
      const s = deckStates(pool.states, d.meta.id).get(card.id);
      let msg;
      if (result === 'right') {
        msg = extra.typed && !extra.exact ? `✓ ${card.answer} (you typed “${extra.typed}”)` : `✓ ${card.answer}`;
        if (how === 'mc' && s.box >= TYPED_FROM_BOX && ctx.settings.typing) msg += ' · next time you type it';
      } else if (result === 'dunno') {
        msg = `It’s ${card.answer}.`;
      } else if (extra.picked) {
        msg = `✗ That’s ${d.byId.get(extra.picked).answer}. This is ${card.answer}.`;
      } else if (extra.other) {
        msg = `✗ ${extra.other.answer} is a different ${d.deck.noun || 'answer'}. This is ${card.answer}.`;
      } else {
        msg = `✗ It’s ${card.answer}. You typed “${extra.typed}”.`;
      }
      feedback.className = `fc-feedback ${result}`;
      feedback.replaceChildren(
        h('span', {}, msg),
        h('button', { class: 'primary fc-next', onclick: ask }, 'Another →'),
        h('span', { class: 'muted small' }, ' Space / Enter'),
      );
      let fav = favoriteFact(card, (await eventsByDeck(ctx, [d], 'fact_pick')).get(d.meta.id));
      // replaceChildren would print a missing item as "null", so drop them.
      const showInfo = (other) => info.replaceChildren(...cardInfo(d.deck, card, {
        fav,
        other,
        async onPick(fact) {
          await ctx.logIn(ns, 'fact_pick', { card: card.id, fact });
          const old = fav;
          fav = fact;
          showInfo(old); // keep the old favorite on screen so the swap can be reversed
        },
      }).filter(Boolean));
      showInfo(randomFact(card, fav));
      feedback.querySelector('.fc-next').focus();
      updateProgress(d, pool);
    }

    document.addEventListener('keydown', (e) => {
      if (!current) return;
      const focused = document.activeElement;
      if (current.answered) {
        if (e.key === 'Enter' && !['BUTTON', 'A'].includes(focused?.tagName)) ask();
        // Space continues unless it's meant for another button or link (e.g. "★ More interesting").
        if (e.key === ' ' && !e.repeat && (focused?.classList.contains('fc-next') || !['BUTTON', 'A'].includes(focused?.tagName))) {
          takeSpace(e);
          ask();
        }
        return;
      }
      if (current.kind !== 'mc') return;
      if (e.key === '0' || e.key === '?') answer('dunno', 'mc');
      if (e.key === ' ' && !e.repeat) { takeSpace(e); answer('dunno', 'mc'); }
      const btn = answerArea.querySelector(`.fc-choice[data-key="${e.key}"]`);
      if (btn) btn.click();
    });

    document.addEventListener('keyup', (e) => {
      if (e.key === ' ' && swallowSpaceUp) { e.preventDefault(); swallowSpaceUp = false; }
    }, true);

    await ask();
  },

  async mountSettings(el, ctx) {
    const s = ctx.settings;
    const status = h('span', { class: 'status small' });
    const deckBoxes = DECKS.map((meta) => {
      const box = h('input', { type: 'checkbox', checked: s.decks?.[meta.id] !== false });
      return { meta, box, row: h('label', { class: 'row' }, box, h('span', {}, h('strong', {}, meta.title), ' ', h('span', { class: 'muted small' }, meta.description))) };
    });
    const label = h('input', { type: 'text', value: s.phoneLabel, 'aria-label': 'What to call the number' });
    const number = h('input', { type: 'tel', value: s.phoneNumber, placeholder: '(555) 555-0123', 'aria-label': 'Phone number', autocomplete: 'off' });
    const typing = h('input', { type: 'checkbox', checked: s.typing });
    const maxLearning = h('input', { type: 'number', min: 1, max: 30, value: s.maxLearning, style: { width: '5em' } });

    el.replaceChildren(h('div', { class: 'stack' },
      h('div', { class: 'stack' }, h('strong', {}, 'Decks'), ...deckBoxes.map((b) => b.row)),
      h('div', { class: 'stack' },
        h('div', {}, h('strong', {}, 'Phone number'),
          h('div', { class: 'muted small' }, 'Kept in this extension’s settings (and your sync server), not in the code.')),
        h('div', { class: 'row' }, number, label),
        h('div', { class: 'muted small' }, 'The second box is how questions name it: “Area code of her number”.'),
      ),
      h('label', { class: 'row' }, typing, 'Graduate cards to typing the answer'),
      h('label', { class: 'row' }, maxLearning, 'new cards in play at once, per deck'),
      h('div', { class: 'row' },
        h('button', {
          class: 'primary',
          onclick: async () => {
            if (number.value.trim() && !parseNumber(number.value)) {
              status.className = 'status small err';
              status.textContent = 'Not saved: a phone number needs 10 digits.';
              return;
            }
            await ctx.saveSettings({
              decks: Object.fromEntries(deckBoxes.map((b) => [b.meta.id, b.box.checked])),
              phoneLabel: label.value.trim() || 'the number',
              phoneNumber: number.value.trim(),
              typing: typing.checked,
              maxLearning: Math.max(1, Number(maxLearning.value) || 6),
            });
            status.className = 'status small ok';
            status.textContent = 'Saved';
          },
        }, 'Save'),
        status,
      ),
    ));
  },

  async summary(ctx) {
    const decks = await loadDecks(ctx);
    if (!decks.length) return 'No decks on';
    const pool = await snapshot(ctx, decks);
    const parts = decks.map((d) => `${d.meta.title.split(' ')[0]} ${deckStates(pool.states, d.meta.id).size}/${d.deck.cards.length}`);
    return `${parts.join(' · ')} · ${pool.today} today`;
  },
};
