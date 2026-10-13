// Service worker: keeps blocking rules in sync with settings, and runs sync.
import { buildRules } from './core/rules.js';
import { getSections, getEnabled } from './core/settings.js';
import { syncNow } from './core/sync.js';

const SYNC_ALARM = 'sync';
const SYNC_MINUTES = 15;

// Serialized: overlapping updateDynamicRules calls can collide on rule ids.
let chain = Promise.resolve();
function applyRules() {
  chain = chain.then(applyRulesNow, applyRulesNow);
  return chain;
}

async function applyRulesNow() {
  const sections = await getSections();
  const enabled = await getEnabled(sections);
  const rules = buildRules(sections, enabled, chrome.runtime.getURL('blocked.html'));
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: rules,
  });
}

async function ensureAlarm() {
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

chrome.alarms.onAlarm.addListener((alarm) => {
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
