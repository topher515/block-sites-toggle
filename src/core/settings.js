// Settings live in chrome.storage.local.
//
// Synced across devices (last write wins, by updatedAt):
//   settings = { [key]: { value, updatedAt } }
//   keys: 'mode', 'sections', 'mode:<modeId>'
//
// Local to this device:
//   enabled_<sectionId>  boolean   (the popup toggles; key name predates modes)
//   device               { id, name }
//   sync                 { url, token }
//   syncState            { cursor, lastSyncAt, lastError }
import defaults from '../defaults.js';

const local = chrome.storage.local;

export async function allSettings() {
  const { settings = {} } = await local.get('settings');
  return settings;
}

export async function getSetting(key, fallback) {
  const settings = await allSettings();
  return key in settings ? settings[key].value : fallback;
}

export async function setSetting(key, value) {
  const settings = await allSettings();
  settings[key] = { value, updatedAt: Date.now() };
  await local.set({ settings });
}

// Merge remote settings in (last write wins). Returns the merged map.
export async function mergeSettings(remote) {
  const settings = await allSettings();
  let changed = false;
  for (const [key, entry] of Object.entries(remote)) {
    if (!settings[key] || entry.updatedAt > settings[key].updatedAt) {
      settings[key] = entry;
      changed = true;
    }
  }
  if (changed) await local.set({ settings });
  return settings;
}

export async function getSections() {
  return getSetting('sections', defaults.sections);
}

export async function getActiveModeId() {
  return getSetting('mode', defaults.mode);
}

export async function getEnabled(sections) {
  const keys = sections.map((s) => `enabled_${s.id}`);
  const res = await local.get(keys);
  const out = {};
  for (const s of sections) {
    const v = res[`enabled_${s.id}`];
    out[s.id] = typeof v === 'boolean' ? v : s.enabledByDefault !== false;
  }
  return out;
}

export async function setEnabled(sectionId, enabled) {
  await local.set({ [`enabled_${sectionId}`]: enabled });
}

export async function getDevice() {
  const { device } = await local.get('device');
  if (device) return device;
  const id = 'd-' + crypto.randomUUID().slice(0, 8);
  const created = { id, name: id };
  await local.set({ device: created });
  return created;
}

export async function setDeviceName(name) {
  const device = await getDevice();
  await local.set({ device: { ...device, name } });
}

export async function getSyncConfig() {
  // Once saved on the options page (even blank, to turn sync off), that wins over build defaults.
  const { sync } = await local.get('sync');
  if (sync) return sync;
  return defaults.sync || { url: '', token: '' };
}

export async function setSyncConfig(sync) {
  await local.set({ sync, syncState: {} });
}

export async function getSyncState() {
  const { syncState = {} } = await local.get('syncState');
  return syncState;
}

export async function setSyncState(patch) {
  const current = await getSyncState();
  await local.set({ syncState: { ...current, ...patch } });
}
