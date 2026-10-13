// Mode registry and the `ctx` object handed to modes. Used by extension pages
// (blocked, popup, options), not by the service worker.
//
// A module folder (src/modules/<dir>/index.js) default-exports one mode object
// or an array of them. See src/modules/AGENTS.md for the contract.
import registry from '../modules/registry.js';
import { logEvent, eventsFor } from './store.js';
import { getSetting, setSetting, getActiveModeId } from './settings.js';
import * as stats from './stats.js';

export const MODES = registry
  .flatMap(({ dir, exports }) => (Array.isArray(exports) ? exports : [exports]).map((m) => ({ ...m, dir })))
  .sort((a, b) => (a.order ?? 100) - (b.order ?? 100) || a.title.localeCompare(b.title));

export function findMode(id) {
  return MODES.find((m) => m.id === id) || MODES.find((m) => m.id === 'focus') || MODES[0];
}

export async function getActiveMode() {
  return findMode(await getActiveModeId());
}

export async function setActiveMode(id) {
  await setSetting('mode', id);
}

export async function getModeSettings(mode) {
  const saved = await getSetting(`mode:${mode.id}`, {});
  return { ...(mode.defaultSettings || {}), ...saved };
}

export async function makeCtx(mode, { blocked = null } = {}) {
  const settingsKey = `mode:${mode.id}`;
  const ctx = {
    modeId: mode.id,
    settings: await getModeSettings(mode),
    async saveSettings(patch) {
      const saved = await getSetting(settingsKey, {});
      await setSetting(settingsKey, { ...saved, ...patch });
      ctx.settings = await getModeSettings(mode);
    },
    async replaceSettings(value) {
      await setSetting(settingsKey, value);
      ctx.settings = await getModeSettings(mode);
    },
    log: (type, data) => logEvent(mode.id, type, data),
    undo: (target) => logEvent(mode.id, 'undo', { target }),
    // Effective (undo-applied) events for this mode, oldest first, from all devices.
    async events({ type, since } = {}) {
      let rows = stats.effective(await eventsFor(mode.id));
      if (type) rows = rows.filter((e) => e.type === type);
      if (since) rows = rows.filter((e) => e.ts >= since);
      return rows;
    },
    // Events of another namespace, e.g. ctx.eventsOf('core') for blocked visits.
    eventsOf: async (modeId) => stats.effective(await eventsFor(modeId)),
    stats,
    blocked,
    now: () => Date.now(),
    assetUrl: (rel) => chrome.runtime.getURL(`modules/${mode.dir}/${rel}`),
  };
  return ctx;
}
