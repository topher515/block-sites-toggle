#!/usr/bin/env node
// End-to-end check of the sync API.
//   node smoke-test.mjs http://localhost:8787 dev-token            # full test (writes test rows)
//   node smoke-test.mjs https://….workers.dev <token> --read-only  # safe against real data
const args = process.argv.slice(2);
const readOnly = args.includes('--read-only');
const [base = 'http://localhost:8787', token = 'dev-token'] = args.filter((a) => !a.startsWith('--'));

async function call(method, path, body, auth = token) {
  const res = await fetch(base + path, {
    method,
    headers: { Authorization: `Bearer ${auth}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

function expect(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  }
  console.log('ok  ', msg);
}

const run = Date.now().toString(36);
const ev = (i, device) => ({ id: `smoke-${run}-${i}`, ts: Date.now(), device, mode: 'smoke-test', type: 'ping', data: { i } });

expect((await call('GET', '/v1/health')).status === 200, 'health');
expect((await call('GET', '/v1/events', null, 'wrong')).status === 401, 'bad token rejected');

if (readOnly) {
  const r = await call('GET', '/v1/events?after=0&limit=1');
  expect(r.status === 200 && Array.isArray(r.body.events), 'events readable');
  expect((await call('GET', '/v1/settings')).status === 200, 'settings readable');
  console.log('all good (read-only)');
  process.exit(0);
}

const before = (await call('GET', '/v1/events?after=0&limit=1000')).body;
let cursor = before.cursor;
while (before.more) {
  const page = (await call('GET', `/v1/events?after=${cursor}&limit=1000`)).body;
  cursor = page.cursor;
  if (!page.more) break;
}

const a = await call('POST', '/v1/events', { events: [ev(1, 'A'), ev(2, 'A')] });
expect(a.status === 200 && a.body.inserted === 2, 'device A pushes 2 events');
const again = await call('POST', '/v1/events', { events: [ev(1, 'A'), ev(3, 'B')] });
expect(again.body.inserted === 1, 'retrying an event is ignored (dedupe by id)');

const pulled = (await call('GET', `/v1/events?after=${cursor}&limit=2`)).body;
expect(pulled.events.length === 2 && pulled.more === true, 'pull is paginated');
const rest = (await call('GET', `/v1/events?after=${pulled.cursor}&limit=2`)).body;
expect(rest.events.length === 1 && rest.more === false, 'second page has the rest');
expect(rest.events[0].data.i === 3, 'event data round-trips as JSON');

expect((await call('POST', '/v1/events', { events: [{ id: 'x' }] })).status === 400, 'invalid event rejected');

const key = `smoke-${run}`;
await call('PUT', '/v1/settings', { settings: { [key]: { value: { v: 2 }, updatedAt: 2000 } } });
await call('PUT', '/v1/settings', { settings: { [key]: { value: { v: 1 }, updatedAt: 1000 } } });
const s = (await call('GET', '/v1/settings')).body.settings[key];
expect(s.value.v === 2 && s.updatedAt === 2000, 'settings: older write does not win');

console.log('all good');
