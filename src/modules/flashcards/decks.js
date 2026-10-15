// Flashcard decks. Each deck becomes its own mode ("Flashcards: Africa").
//
// A deck lives in decks/<id>/ with:
//   deck.json   { id, title, prompt, wikipedia?, cards: [{ id, answer, aliases?, group?, prompt?, facts?, wiki? }] }
//               After answering, the most interesting fact (facts[0] until the user
//               picks another) and one random other fact are shown. With wikipedia: true, a link
//               too; card.wiki overrides the article title (default: answer).
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
