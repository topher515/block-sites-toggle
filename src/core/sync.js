// Sync with the Cloudflare Worker (see worker/). Runs in the service worker.
//
// 1. push: send this device's unsynced events (batched)
// 2. pull: fetch everyone's events after our cursor (server-assigned seq)
// 3. settings: merge last-write-wins both ways
import { pendingEvents, markSynced, putRemoteEvents } from './store.js';
import { mergeSettings, getSyncConfig, getSyncState, setSyncState } from './settings.js';

const PUSH_BATCH = 200;
const PULL_LIMIT = 500;

let running = null;

export function syncNow() {
  if (!running) running = run().finally(() => (running = null));
  return running;
}

async function run() {
  const { url, token } = await getSyncConfig();
  if (!url || !token) return { status: 'off' };

  const api = makeApi(url, token);
  try {
    let pushed = 0;
    for (;;) {
      const batch = await pendingEvents(PUSH_BATCH);
      if (!batch.length) break;
      await api('POST', '/v1/events', { events: batch.map(({ synced, ...e }) => e) });
      await markSynced(batch);
      pushed += batch.length;
      if (batch.length < PUSH_BATCH) break;
    }

    let { cursor = 0 } = await getSyncState();
    let pulled = 0;
    for (;;) {
      const res = await api('GET', `/v1/events?after=${cursor}&limit=${PULL_LIMIT}`);
      await putRemoteEvents(res.events);
      pulled += res.events.length;
      cursor = res.cursor;
      await setSyncState({ cursor });
      if (!res.more) break;
    }

    const remote = await api('GET', '/v1/settings');
    const merged = await mergeSettings(remote.settings);
    const newer = {};
    for (const [key, entry] of Object.entries(merged)) {
      const r = remote.settings[key];
      if (!r || entry.updatedAt > r.updatedAt) newer[key] = entry;
    }
    if (Object.keys(newer).length) await api('PUT', '/v1/settings', { settings: newer });

    const state = { lastSyncAt: Date.now(), lastError: null, lastPushed: pushed, lastPulled: pulled };
    await setSyncState(state);
    return { status: 'ok', ...state };
  } catch (err) {
    const lastError = String(err && err.message ? err.message : err);
    await setSyncState({ lastError, lastErrorAt: Date.now() });
    return { status: 'error', error: lastError };
  }
}

function makeApi(baseUrl, token) {
  const base = baseUrl.replace(/\/+$/, '');
  return async (method, path, body) => {
    const res = await fetch(base + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text()}`);
    return res.json();
  };
}
