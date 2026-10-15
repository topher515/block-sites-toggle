import { h } from './core/dom.js';
import { getSections, getEnabled, setEnabled, getSyncConfig, getSyncState } from './core/settings.js';
import { siteToHost } from './core/rules.js';
import { applyRulesNow, missingPermissions } from './core/blocking.js';
import { getActiveMode, makeCtx } from './core/modes.js';
import { ago } from './core/time.js';

async function renderSections() {
  const sections = await getSections();
  const enabled = await getEnabled(sections);
  const root = document.getElementById('sections');
  root.replaceChildren(
    ...sections.flatMap((s) => [
      h('button', {
        class: enabled[s.id] ? 'on' : '',
        onclick: async () => {
          await setEnabled(s.id, !enabled[s.id]);
          await applyRules();
          renderSections();
        },
      }, `${s.title}: ${enabled[s.id] ? 'ON' : 'OFF'}`),
      h('small', {}, s.sites.map(siteToHost).join(', ')),
    ]),
  );
}

// Prefer the service worker (it serializes rule writes). If it is not running, write the
// rules from here, so a toggle never depends on the worker.
async function applyRules() {
  const warn = document.getElementById('warn');
  try {
    const res = await chrome.runtime.sendMessage({ type: 'applyRules' });
    if (res && res.ok) return;
  } catch {
    // No receiver: the service worker failed to start.
  }
  try {
    await applyRulesNow();
  } catch (err) {
    warn.textContent = `Could not update blocking rules: ${err.message}`;
  }
}

async function renderWarnings() {
  const missing = await missingPermissions();
  if (missing.length) {
    document.getElementById('warn').textContent =
      `Missing permissions: ${missing.join(', ')}. Remove and load the extension again to grant them.`;
  }
}

async function renderMode() {
  const mode = await getActiveMode();
  document.getElementById('mode-title').textContent = mode.title;
  if (mode.summary) {
    document.getElementById('summary').textContent = await mode.summary(await makeCtx(mode));
  }
}

async function renderSync() {
  const { url } = await getSyncConfig();
  const state = await getSyncState();
  const el = document.getElementById('sync');
  if (!url) el.textContent = 'Sync: off';
  else if (state.lastError && (state.lastErrorAt || 0) > (state.lastSyncAt || 0)) el.textContent = `Sync error: ${state.lastError.slice(0, 80)}`;
  else el.textContent = state.lastSyncAt ? `Synced ${ago(state.lastSyncAt)}` : 'Sync: not yet';
}

renderSections();
renderWarnings();
renderMode();
renderSync();
