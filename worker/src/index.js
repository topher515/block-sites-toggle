// Sync server for Block Sites (Toggle): an append-only event log plus a small
// last-write-wins settings map, in D1.
//
//   GET  /v1/health
//   POST /v1/events        { events: [{ id, ts, device, mode, type, data }] }
//   GET  /v1/events?after=<seq>&limit=<n>   -> { events, cursor, more }
//   GET  /v1/settings      -> { settings: { key: { value, updatedAt } } }
//   PUT  /v1/settings      { settings: { key: { value, updatedAt } } }
//
// Auth: `Authorization: Bearer <SYNC_TOKEN>`. Everything is stored under one
// user id for now; the column exists so per-user tokens can be added later.

const USER = 'me';
const MAX_BATCH = 500;
const MAX_DATA_BYTES = 8 * 1024;
const MAX_LIMIT = 1000;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...CORS } });
}

const fail = (status, error) => json({ error }, status);

function authorized(request, env) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expected = env.SYNC_TOKEN || '';
  if (!expected || token.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < token.length; i++) diff |= token.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function validEvent(e) {
  return (
    e && typeof e === 'object' &&
    typeof e.id === 'string' && e.id.length > 0 && e.id.length <= 64 &&
    Number.isFinite(e.ts) &&
    typeof e.device === 'string' && e.device.length <= 64 &&
    typeof e.mode === 'string' && e.mode.length > 0 && e.mode.length <= 64 &&
    typeof e.type === 'string' && e.type.length > 0 && e.type.length <= 64
  );
}

async function postEvents(request, env) {
  const body = await request.json().catch(() => null);
  const events = body && Array.isArray(body.events) ? body.events : null;
  if (!events) return fail(400, 'expected { events: [...] }');
  if (events.length > MAX_BATCH) return fail(413, `at most ${MAX_BATCH} events per request`);

  const now = Date.now();
  const stmts = [];
  for (const e of events) {
    if (!validEvent(e)) return fail(400, `invalid event: ${JSON.stringify(e).slice(0, 200)}`);
    const data = JSON.stringify(e.data ?? {});
    if (data.length > MAX_DATA_BYTES) return fail(413, `event ${e.id} data too large`);
    stmts.push(
      env.DB.prepare(
        'INSERT OR IGNORE INTO events (user_id, id, ts, device, mode, type, data, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(USER, e.id, Math.round(e.ts), e.device, e.mode, e.type, data, now),
    );
  }
  let inserted = 0;
  for (let i = 0; i < stmts.length; i += 100) {
    const results = await env.DB.batch(stmts.slice(i, i + 100));
    for (const r of results) inserted += r.meta.changes || 0;
  }
  return json({ ok: true, received: events.length, inserted });
}

async function getEvents(url, env) {
  const after = Math.max(0, parseInt(url.searchParams.get('after') || '0', 10) || 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get('limit') || '500', 10) || 500));
  const { results } = await env.DB.prepare(
    'SELECT seq, id, ts, device, mode, type, data FROM events WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?',
  ).bind(USER, after, limit + 1).all();
  const more = results.length > limit;
  const rows = results.slice(0, limit);
  return json({
    events: rows.map(({ seq, data, ...e }) => ({ ...e, data: JSON.parse(data) })),
    cursor: rows.length ? rows[rows.length - 1].seq : after,
    more,
  });
}

async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT key, value, updated_at FROM settings WHERE user_id = ?').bind(USER).all();
  const settings = {};
  for (const r of results) settings[r.key] = { value: JSON.parse(r.value), updatedAt: r.updated_at };
  return json({ settings });
}

async function putSettings(request, env) {
  const body = await request.json().catch(() => null);
  const settings = body && body.settings && typeof body.settings === 'object' ? body.settings : null;
  if (!settings) return fail(400, 'expected { settings: { key: { value, updatedAt } } }');
  const stmts = [];
  for (const [key, entry] of Object.entries(settings)) {
    if (key.length > 128 || !entry || !Number.isFinite(entry.updatedAt)) return fail(400, `invalid setting ${key}`);
    const value = JSON.stringify(entry.value ?? null);
    if (value.length > 64 * 1024) return fail(413, `setting ${key} too large`);
    stmts.push(
      env.DB.prepare(
        `INSERT INTO settings (user_id, key, value, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
         WHERE excluded.updated_at > settings.updated_at`,
      ).bind(USER, key, value, Math.round(entry.updatedAt)),
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
  return json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/v1/health') return json({ ok: true });
    if (!authorized(request, env)) return fail(401, 'unauthorized');

    try {
      const route = `${request.method} ${url.pathname}`;
      if (route === 'POST /v1/events') return await postEvents(request, env);
      if (route === 'GET /v1/events') return await getEvents(url, env);
      if (route === 'GET /v1/settings') return await getSettings(env);
      if (route === 'PUT /v1/settings') return await putSettings(request, env);
      return fail(404, 'not found');
    } catch (err) {
      console.error(err);
      return fail(500, 'server error');
    }
  },
};
