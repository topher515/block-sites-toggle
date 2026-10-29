// A map deck's picture: map.svg with the card's region highlighted. Shared by the map decks'
// render.js. The SVG holds one <g data-id data-cx data-cy data-small> per card.
const SVG_NS = 'http://www.w3.org/2000/svg';

export async function createMap(stage, { assetUrl }, label) {
  const text = await (await fetch(assetUrl('map.svg'))).text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = document.importNode(doc.documentElement, true);
  svg.classList.add('fc-map');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', label);
  const markers = document.createElementNS(SVG_NS, 'g');
  svg.append(markers);
  stage.replaceChildren(svg);

  function mark(id, cls) {
    const g = svg.querySelector(`g[data-id="${id}"]`);
    if (!g) return;
    g.classList.add(cls);
    // Tiny regions get a ring so they're findable.
    if (g.dataset.small) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cx', g.dataset.cx);
      c.setAttribute('cy', g.dataset.cy);
      c.setAttribute('r', 16);
      c.setAttribute('class', `fc-marker ${cls}`);
      markers.append(c);
    }
  }

  function clear() {
    svg.querySelectorAll('g.target, g.picked').forEach((g) => g.classList.remove('target', 'picked'));
    markers.replaceChildren();
  }

  return {
    show(card) {
      clear();
      mark(card.id, 'target');
    },
    reveal(card, { picked } = {}) {
      if (picked && picked !== card.id) mark(picked, 'picked');
    },
  };
}
