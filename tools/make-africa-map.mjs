#!/usr/bin/env node
// Generates src/modules/flashcards/decks/africa/map.svg from Natural Earth
// (public domain) 1:50m admin-0 countries.
//
//   curl -sSL -o /tmp/ne50.geojson \
//     https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson
//   cd tools && npm install && node make-africa-map.mjs /tmp/ne50.geojson
//
// Each country becomes <g data-id="KE" data-cx data-cy data-small> holding its
// path(s). Somaliland is drawn as part of Somalia; Western Sahara is drawn but
// has data-id="EH" and is not in the deck. Saint Helena is skipped.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { geoMercator, geoPath, geoArea } from 'd3-geo';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '../src/modules/flashcards/decks/africa/map.svg');
const src = process.argv[2];
if (!src) {
  console.error('usage: node make-africa-map.mjs <ne_50m_admin_0_countries.geojson>');
  process.exit(1);
}

const REGIONS = ['Eastern Africa', 'Middle Africa', 'Northern Africa', 'Southern Africa', 'Western Africa'];
const SKIP = new Set(['SHN']);
const MERGE = { SOL: 'SO' }; // ADM0_A3 -> id of the country it is drawn as

// Drop far-flung islands that would stretch the map (e.g. South Africa's
// Prince Edward Islands at 46°S).
function trimIslands(f) {
  if (f.geometry.type !== 'MultiPolygon') return f;
  const coordinates = f.geometry.coordinates.filter((poly) => poly[0].some(([, lat]) => lat > -40));
  return { ...f, geometry: { ...f.geometry, coordinates } };
}

const all = JSON.parse(fs.readFileSync(src, 'utf8')).features.map(trimIslands);
const features = all.filter((f) => REGIONS.includes(f.properties.SUBREGION) && !SKIP.has(f.properties.ADM0_A3));

const W = 800;
const H = 860;
const projection = geoMercator().fitExtent([[10, 10], [W - 10, H - 10]], { type: 'FeatureCollection', features });
const pathGen = geoPath(projection).digits(1);

const groups = new Map(); // id -> { paths: [], feature }
for (const f of features) {
  const p = f.properties;
  const id = MERGE[p.ADM0_A3] || p.ISO_A2_EH;
  if (!groups.has(id)) groups.set(id, { paths: [], feature: null });
  const g = groups.get(id);
  g.paths.push(pathGen(f));
  if (!MERGE[p.ADM0_A3]) g.feature = f;
}

// Countries smaller than this (steradians) get a visible marker when highlighted.
const SMALL_AREA = 0.003; // ~120,000 km²: Togo, Benin, Malawi and smaller

const body = [...groups.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([id, g]) => {
    const [cx, cy] = pathGen.centroid(g.feature).map((n) => n.toFixed(1));
    const small = geoArea(g.feature) < SMALL_AREA ? ' data-small="1"' : '';
    const paths = g.paths.map((d) => `<path d="${d}"/>`).join('');
    return `<g data-id="${id}" data-cx="${cx}" data-cy="${cy}"${small}>${paths}</g>`;
  })
  .join('\n');

// Crop the viewBox to the drawn content.
const [[x0, y0], [x1, y1]] = pathGen.bounds({ type: 'FeatureCollection', features });
const pad = 20;
const viewBox = [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad].map((n) => n.toFixed(0)).join(' ');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" data-source="Natural Earth 1:50m (public domain)">
${body}
</svg>
`;
fs.writeFileSync(out, svg);
console.log(`wrote ${out} (${groups.size} countries, ${(svg.length / 1024).toFixed(0)} KB)`);
