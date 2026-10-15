// Service worker: keeps blocking rules in sync with settings, and runs sync.
import { applyRulesNow } from './core/blocking.js';
import { syncNow } from './core/sync.js';

const SYNC_ALARM = 'sync';
const SYNC_MINUTES = 15;

// Serialized: overlapping updateDynamicRules calls can collide on rule ids.
let chain = Promise.resolve();
function applyRules() {
  chain = chain.then(applyRulesNow, applyRulesNow);
  return chain;
}

// chrome.alarms is undefined if the browser has not granted the permission. Blocking must
// still work then, so nothing here may throw at load time.
async function ensureAlarm() {
  if (!chrome.alarms) return;
  if (!(await chrome.alarms.get(SYNC_ALARM))) {
    await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_MINUTES, delayInMinutes: 1 });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  applyRules();
  ensureAlarm();
  syncNow();
});

chrome.runtime.onStartup.addListener(() => {
  applyRules();
  ensureAlarm();
  syncNow();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const settingsChanged =
    changes.settings &&
    JSON.stringify(changes.settings.oldValue?.sections) !== JSON.stringify(changes.settings.newValue?.sections);
  const toggled = Object.keys(changes).some((k) => k.startsWith('enabled_'));
  if (settingsChanged || toggled) applyRules();
});

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) syncNow();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'sync') {
    syncNow().then(sendResponse);
    return true;
  }
  if (msg && msg.type === 'applyRules') {
    applyRules().then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e) }));
    return true;
  }
  return false;
});
