// Flashcard decks. All of them feed the one Memorization mode, which keeps a single queue
// across the enabled decks. Each deck's answers are logged in its own namespace,
// `flashcards-<id>`, so turning a deck off or on never loses its progress.
//
// A deck lives in decks/<id>/ with:
//   deck.json   { id, title, prompt, noun?, wikipedia?, cards: [{ id, answer, aliases?, group?, prompt?, question?, facts?, wiki? }] }
//               noun names one card's kind in feedback ("a different country").
//               After answering, the most interesting fact (facts[0] until the user
//               picks another) and one random other fact are shown. With wikipedia: true, a link
//               too; card.wiki overrides the article title (default: answer).
//   render.js   optional; exports create(stage, { assetUrl }) -> { show(card), reveal(card, { picked }) }
//               Without it, card.prompt is shown as big text.
//
// A deck with `cards(settings)` instead is built from settings and has no folder (the phone
// number, which must not be committed). `typedOnly` skips multiple choice; `check` replaces
// the forgiving name matcher.
import { phoneCards, checkDigits } from './phone.js';

export const DECKS = [
  {
    id: 'africa',
    title: 'Africa 🌍',
    description: 'Name the highlighted African country.',
    renderer: () => import('./decks/africa/render.js'),
  },
  {
    id: 'states',
    title: 'Middle America 🌽',
    // The coastal states (Pacific, Atlantic, Texas) are drawn on the map but not asked.
    description: 'Name the highlighted inland US state.',
    renderer: () => import('./decks/states/render.js'),
  },
  {
    id: 'phone',
    title: 'Phone number 📞',
    description: 'Area code, middle three, last four, then the whole number.',
    typedOnly: true,
    check: checkDigits,
    cards: (settings) => ({
      prompt: 'Type the digits',
      noun: 'number',
      cards: phoneCards(settings.phoneNumber, settings.phoneLabel),
    }),
  },
];

export const namespace = (deckId) => `flashcards-${deckId}`;
