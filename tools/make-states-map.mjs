#!/usr/bin/env node
// Generates src/modules/flashcards/decks/states/map.svg from us-atlas
// (US Census Bureau cartographic boundaries, public domain), already projected
// to Albers USA with Alaska and Hawaii inset.
//
//   cd tools && npm install && node make-states-map.mjs
//
// Each state becomes <g data-id="CA" data-cx data-cy data-small> holding its
// path. DC is drawn with data-id="DC" but is not in the deck.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { geoPath } from 'd3-geo';
import { feature } from 'topojson-client';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, '../src/modules/flashcards/decks/states/map.svg');
const us = createRequire(import.meta.url)('us-atlas/states-albers-10m.json');

// FIPS code -> postal code.
const POSTAL = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT', '10': 'DE',
  '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL', '18': 'IN', '19': 'IA',
  '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD', '25': 'MA', '26': 'MI', '27': 'MN',
  '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE', '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM',
  '36': 'NY', '37': 'NC', '38': 'ND', '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI',
  '45': 'SC', '46': 'SD', '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA',
  '54': 'WV', '55': 'WI', '56': 'WY',
};

// Already projected, so no projection: coordinates are pixels.
const pathGen = geoPath().digits(1);
const states = feature(us, us.objects.states).features;

// States smaller than this (square pixels) get a visible ring when highlighted.
const SMALL_AREA = 1200; // New England but Maine, New Jersey, Delaware, Maryland, DC, Hawaii

const body = states
  .map((f) => ({ id: POSTAL[f.id], f }))
  .sort((a, b) => a.id.localeCompare(b.id))
  .map(({ id, f }) => {
    const [cx, cy] = pathGen.centroid(f).map((n) => n.toFixed(1));
    const small = pathGen.area(f) < SMALL_AREA ? ' data-small="1"' : '';
    return `<g data-id="${id}" data-cx="${cx}" data-cy="${cy}"${small}><path d="${pathGen(f)}"/></g>`;
  })
  .join('\n');

const [[x0, y0], [x1, y1]] = pathGen.bounds({ type: 'FeatureCollection', features: states });
const pad = 10;
const viewBox = [x0 - pad, y0 - pad, x1 - x0 + 2 * pad, y1 - y0 + 2 * pad].map((n) => n.toFixed(0)).join(' ');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" data-source="US Census Bureau via us-atlas (public domain)">
${body}
</svg>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, svg);
console.log(`wrote ${out} (${states.length} states, ${(svg.length / 1024).toFixed(0)} KB)`);
