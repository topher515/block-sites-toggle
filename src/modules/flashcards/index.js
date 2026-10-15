// Flashcards engine. One mode per deck in decks.js. Each answer is a `review` event:
//   { card, result: 'right'|'wrong'|'dunno', how: 'mc'|'typed' }
// Choosing a card's most interesting fact is a `fact_pick` event (see facts.js).
// Scheduling (srs.js) is recomputed from those events every time.
import { h, useCss } from '../../core/dom.js';
import { DECKS } from './decks.js';
import { replay, pickCard, questionKind, choices, deckProgress, TYPED_FROM_BOX } from './srs.js';
import { check } from './match.js';
import { favoriteFact, randomFact } from './facts.js';

const deckCache = new Map();
async function loadDeck(ctx, deckId) {
  if (!deckCache.has(deckId)) {
    deckCache.set(deckId, fetch(ctx.assetUrl(`decks/${deckId}/deck.json`)).then((r) => r.json()));
  }
  return deckCache.get(deckId);
}

function textRenderer(stage) {
  const box = h('div', { class: 'fc-text' });
  stage.replaceChildren(box);
  return {
    show(card) { box.textContent = card.prompt || card.id; },
    reveal() {},
  };
}

// What to show about a card after it's answered: capital, the most interesting fact, one
// random other fact (which the user can promote to most interesting), and a Wikipedia link.
function cardInfo(deck, card, { fav, other, onPick }) {
  const wiki = deck.wikipedia ? card.wiki || card.answer.replaceAll(' ', '_') : null;
  return [
    card.capital && h('p', { class: 'fc-capital' }, h('span', { class: 'muted' }, 'Capital: '), card.capital),
    fav && h('p', { class: 'fc-fact fc-fav' }, h('span', { class: 'fc-fact-label' }, '★ Most interesting'), fav),
    other && h('p', { class: 'fc-fact' }, h('span', { class: 'fc-fact-label' }, 'Did you know?'), other,
      h('button', { class: 'ghost small fc-pick', title: 'Make this the most interesting fact', onclick: () => onPick(other) }, '★ More interesting')),
    wiki && h('a', { href: `https://en.wikipedia.org/wiki/${encodeURIComponent(wiki)}`, target: '_blank', rel: 'noopener', class: 'small' },
      `${card.answer} on Wikipedia ↗`),
  ];
}

function makeDeckMode(meta) {
  return {
    id: `flashcards-${meta.id}`,
    title: meta.title,
    description: meta.description,
    order: 20,
    defaultSettings: {
      typing: true,     // graduate cards to typed answers
      maxLearning: 6,   // how many cards can be in the multiple-choice stage at once
    },

    async mount(el, ctx) {
      useCss(ctx.assetUrl('flashcards.css'));
      const deck = await loadDeck(ctx, meta.id);
      const stage = h('div', { class: 'fc-stage' });
      const prompt = h('h2', { class: 'fc-prompt' });
      const answerArea = h('div', { class: 'fc-answer' });
      const feedback = h('div', { class: 'fc-feedback', 'aria-live': 'polite' });
      const info = h('div', { class: 'fc-info' });
      const progress = h('p', { class: 'fc-progress muted small num' });
      el.replaceChildren(h('div', { class: 'fc' }, stage, prompt, answerArea, feedback, info, progress));

      const assetUrl = (rel) => ctx.assetUrl(`decks/${meta.id}/${rel}`);
      const renderer = meta.renderer
        ? await (await meta.renderer()).create(stage, { assetUrl })
        : textRenderer(stage);

      let current = null; // { card, kind, answered }
      let lastCardId = null;
      const byId = new Map(deck.cards.map((c) => [c.id, c]));

      async function updateProgress(states) {
        const p = deckProgress(deck.cards, states);
        const today = await ctx.events({ type: 'review', since: ctx.stats.startOfDay(ctx.now()) });
        progress.textContent =
          `Seen ${p.seen}/${p.total} · typing ${p.learned} · mastered ${p.mastered} · ${today.length} answered today`;
      }

      async function ask() {
        const states = replay(await ctx.events({ type: 'review' }));
        const card = pickCard(deck.cards, states, ctx.now(), {
          maxLearning: ctx.settings.maxLearning,
          avoid: lastCardId,
        });
        const state = states.get(card.id);
        const kind = questionKind(state, ctx.settings);
        current = { card, kind, answered: false };
        renderer.show(card);
        prompt.textContent = card.question || deck.prompt;
        feedback.replaceChildren();
        feedback.className = 'fc-feedback';
        info.replaceChildren();

        const dunno = h('button', { class: 'ghost fc-dunno', onclick: () => answer('dunno', kind) }, "I don't know");
        if (kind === 'mc') {
          const opts = choices(card, deck.cards);
          answerArea.replaceChildren(
            h('div', { class: 'fc-choices' },
              opts.map((c, i) =>
                h('button', { class: 'fc-choice', 'data-key': i + 1, onclick: () => answer(c.id === card.id ? 'right' : 'wrong', 'mc', { picked: c.id }) },
                  h('span', { class: 'fc-key' }, i + 1), c.answer))),
            h('div', { class: 'row fc-sub' }, dunno, h('span', { class: 'muted small' }, 'Keys: 1–4, 0 = don’t know')),
          );
        } else {
          const input = h('input', { type: 'text', class: 'fc-input', placeholder: 'Type the answer', autocomplete: 'off', spellcheck: 'false' });
          const submit = () => {
            if (!input.value.trim()) return;
            const res = check(input.value, card, deck.cards);
            answer(res.ok ? 'right' : 'wrong', 'typed', { typed: input.value, exact: res.exact, other: res.other });
          };
          input.addEventListener('keydown', (e) => {
            e.stopPropagation(); // keep the page-level Enter = "Another" from firing too
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') answer('dunno', 'typed');
          });
          answerArea.replaceChildren(
            h('div', { class: 'row fc-typed' }, input, h('button', { class: 'primary', onclick: submit }, 'Check')),
            h('div', { class: 'row fc-sub' }, dunno, h('span', { class: 'muted small' }, 'Enter = check, Esc = don’t know')),
          );
          input.focus();
        }
        await updateProgress(states);
      }

      async function answer(result, how, extra = {}) {
        if (!current || current.answered) return;
        current.answered = true;
        const { card } = current;
        lastCardId = card.id;
        await ctx.log('review', { card: card.id, result, how });
        renderer.reveal(card, { picked: extra.picked });

        answerArea.querySelectorAll('button, input').forEach((b) => (b.disabled = true));
        answerArea.querySelectorAll('.fc-choice').forEach((b, i) => {
          const opt = b.lastChild.textContent;
          if (opt === card.answer) b.classList.add('right');
          else if (extra.picked && byId.get(extra.picked)?.answer === opt) b.classList.add('wrong');
        });

        const states = replay(await ctx.events({ type: 'review' }));
        const s = states.get(card.id);
        let msg;
        if (result === 'right') {
          msg = extra.typed && !extra.exact ? `✓ ${card.answer} (you typed “${extra.typed}”)` : `✓ ${card.answer}`;
          if (how === 'mc' && s.box >= TYPED_FROM_BOX && ctx.settings.typing) msg += ' · next time you type it';
        } else if (result === 'dunno') {
          msg = `It’s ${card.answer}.`;
        } else if (extra.picked) {
          msg = `✗ That’s ${byId.get(extra.picked).answer}. This is ${card.answer}.`;
        } else if (extra.other) {
          msg = `✗ ${extra.other.answer} is a different country. This is ${card.answer}.`;
        } else {
          msg = `✗ It’s ${card.answer}. You typed “${extra.typed}”.`;
        }
        feedback.className = `fc-feedback ${result}`;
        feedback.replaceChildren(
          h('span', {}, msg),
          h('button', { class: 'primary fc-next', onclick: ask }, 'Another →'),
          h('span', { class: 'muted small' }, ' Enter'),
        );
        let fav = favoriteFact(card, await ctx.events({ type: 'fact_pick' }));
        const showInfo = (other) => info.replaceChildren(...cardInfo(deck, card, {
          fav,
          other,
          async onPick(fact) {
            await ctx.log('fact_pick', { card: card.id, fact });
            const old = fav;
            fav = fact;
            showInfo(old); // keep the old favorite on screen so the swap can be reversed
          },
        }));
        showInfo(randomFact(card, fav));
        feedback.querySelector('.fc-next').focus();
        await updateProgress(states);
      }

      document.addEventListener('keydown', (e) => {
        if (!current) return;
        if (current.answered) {
          if (e.key === 'Enter' && !['BUTTON', 'A'].includes(document.activeElement?.tagName)) ask();
          return;
        }
        if (current.kind !== 'mc') return;
        if (e.key === '0' || e.key === '?') answer('dunno', 'mc');
        const btn = answerArea.querySelector(`.fc-choice[data-key="${e.key}"]`);
        if (btn) btn.click();
      });

      await ask();
    },

    async summary(ctx) {
      const deck = await loadDeck(ctx, meta.id);
      const reviews = await ctx.events({ type: 'review' });
      const p = deckProgress(deck.cards, replay(reviews));
      const today = reviews.filter((e) => e.ts >= ctx.stats.startOfDay(ctx.now())).length;
      return `Seen ${p.seen}/${p.total} · ${today} answered today`;
    },
  };
}

export default DECKS.map(makeDeckMode);
