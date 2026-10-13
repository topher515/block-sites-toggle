// Flashcard decks. Each deck becomes its own mode ("Flashcards: Africa").
//
// A deck lives in decks/<id>/ with:
//   deck.json   { id, title, prompt, cards: [{ id, answer, aliases?, group?, prompt? }] }
//   render.js   optional; exports create(stage, { assetUrl }) -> { show(card), reveal(card, { picked }) }
//               Without it, card.prompt is shown as big text.
export const DECKS = [
  {
    id: 'africa',
    title: 'Flashcards: Africa 🌍',
    description: 'Name the highlighted African country. Multiple choice first, then typing.',
    renderer: () => import('./decks/africa/render.js'),
  },
];
