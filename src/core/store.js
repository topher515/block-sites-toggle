// The event log, in IndexedDB. Shared by the service worker and extension pages.
//
// Event: { id, ts, device, mode, type, data, synced: 0|1 }
import { ulid } from './ulid.js';
import { getDevice } from './settings.js';

const DB_NAME = 'block-sites-toggle';
const DB_VERSION = 1;

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const events = db.createObjectStore('events', { keyPath: 'id' });
      events.createIndex('mode', 'mode');
      events.createIndex('synced', 'synced');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function logEvent(mode, type, data = {}) {
  const { id: device } = await getDevice();
  const ts = Date.now();
  const event = { id: ulid(ts), ts, device, mode, type, data, synced: 0 };
  const db = await openDb();
  const tx = db.transaction('events', 'readwrite');
  tx.objectStore('events').put(event);
  await done(tx);
  return event;
}

// Events that came from the server. They are already synced.
export async function putRemoteEvents(events) {
  if (!events.length) return;
  const db = await openDb();
  const tx = db.transaction('events', 'readwrite');
  const store = tx.objectStore('events');
  for (const e of events) store.put({ ...e, synced: 1 });
  await done(tx);
}

export async function eventsFor(mode) {
  const db = await openDb();
  const tx = db.transaction('events');
  const rows = await result(tx.objectStore('events').index('mode').getAll(mode));
  return rows.sort((a, b) => a.ts - b.ts);
}

export async function pendingEvents(limit = 200) {
  const db = await openDb();
  const tx = db.transaction('events');
  return result(tx.objectStore('events').index('synced').getAll(0, limit));
}

export async function markSynced(events) {
  const db = await openDb();
  const tx = db.transaction('events', 'readwrite');
  const store = tx.objectStore('events');
  for (const e of events) store.put({ ...e, synced: 1 });
  await done(tx);
}

export async function allEvents() {
  const db = await openDb();
  const tx = db.transaction('events');
  const rows = await result(tx.objectStore('events').getAll());
  return rows.sort((a, b) => a.ts - b.ts);
}

export async function countEvents() {
  const db = await openDb();
  const tx = db.transaction('events');
  const [total, pending] = await Promise.all([
    result(tx.objectStore('events').count()),
    result(tx.objectStore('events').index('synced').count(0)),
  ]);
  return { total, pending };
}
