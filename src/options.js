import { h } from './core/dom.js';
import { MODES, getActiveMode, setActiveMode, makeCtx } from './core/modes.js';
import {
  getSections, setSetting, allSettings, getDevice, setDeviceName,
  getSyncConfig, setSyncConfig, getSyncState,
} from './core/settings.js';
import { siteToHost } from './core/rules.js';
import { allEvents, countEvents } from './core/store.js';
import { ago } from './core/time.js';

const $ = (id) => document.getElementById(id);

function flash(el, text, ok = true) {
  el.className = `status small ${ok ? 'ok' : 'err'}`;
  el.textContent = text;
}

// ---- Mode -------------------------------------------------------------------

async function renderModes() {
  const active = await getActiveMode();
  $('modes').replaceChildren(
    ...MODES.map((m) =>
      h('label', { class: `mode-opt${m.id === active.id ? ' active' : ''}` },
        h('input', {
          type: 'radio', name: 'mode', value: m.id, checked: m.id === active.id,
          onchange: async () => { await setActiveMode(m.id); renderModes(); },
        }),
        h('div', {}, h('strong', {}, m.title), h('div', { class: 'muted small' }, m.description || '')),
      ),
    ),
  );
  renderModeSettings(active);
}

async function renderModeSettings(mode) {
  $('mode-settings-title').textContent = `${mode.title} settings`;
  const root = $('mode-settings');
  const ctx = await makeCtx(mode);
  if (mode.mountSettings) {
    root.replaceChildren();
    await mode.mountSettings(root, ctx);
    return;
  }
  // Generic editor: the merged settings as JSON.
  const area = h('textarea', { rows: 10, spellcheck: 'false' });
  area.value = JSON.stringify(ctx.settings, null, 2);
  const status = h('span', { class: 'status small' });
  root.replaceChildren(
    area,
    h('div', { class: 'row' },
      h('button', {
        class: 'primary',
        onclick: async () => {
          try {
            // Store only what differs from the defaults, so later default changes still apply.
            const edited = JSON.parse(area.value);
            const defaults = mode.defaultSettings || {};
            const changed = Object.fromEntries(
              Object.entries(edited).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(defaults[k])),
            );
            await ctx.replaceSettings(changed);
            flash(status, Object.keys(changed).length ? 'Saved' : 'Saved (all defaults)');
          } catch (e) {
            flash(status, `Not saved: ${e.message}`, false);
          }
        },
      }, 'Save'),
      h('button', {
        onclick: async () => {
          await ctx.replaceSettings({});
          area.value = JSON.stringify(ctx.settings, null, 2);
          flash(status, 'Reset to defaults');
        },
      }, 'Reset to defaults'),
      status,
    ),
  );
}

// ---- Blocked sites ----------------------------------------------------------

let sectionsDraft = [];

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'section';
}

function renderSectionsDraft() {
  $('site-sections').replaceChildren(
    ...sectionsDraft.map((s, i) => {
      const title = h('input', { type: 'text', value: s.title, 'aria-label': 'Section title' });
      title.addEventListener('input', () => (s.title = title.value));
      const sites = h('textarea', { rows: Math.max(3, s.sites.length + 1), spellcheck: 'false' });
      sites.value = s.sites.map(siteToHost).join('\n');
      sites.addEventListener('input', () => (s.sites = sites.value.split('\n').map((l) => l.trim()).filter(Boolean)));
      return h('div', { class: 'site-section stack' },
        h('div', { class: 'row' }, title,
          h('button', { class: 'ghost', onclick: () => { sectionsDraft.splice(i, 1); renderSectionsDraft(); } }, 'Remove')),
        sites,
      );
    }),
  );
}

async function loadSections() {
  sectionsDraft = structuredClone(await getSections());
  renderSectionsDraft();
}

$('add-section').addEventListener('click', () => {
  sectionsDraft.push({ id: '', title: 'New section', enabledByDefault: true, sites: [] });
  renderSectionsDraft();
});

$('save-sections').addEventListener('click', async () => {
  const used = new Set();
  const clean = sectionsDraft.map((s) => {
    let id = s.id || slug(s.title);
    while (used.has(id)) id += '-2';
    used.add(id);
    return { ...s, id, sites: s.sites.map(siteToHost).filter(Boolean) };
  });
  await setSetting('sections', clean);
  const res = await chrome.runtime.sendMessage({ type: 'applyRules' });
  if (res && res.ok) flash($('sections-status'), 'Saved');
  else flash($('sections-status'), `Saved, but rules failed: ${res && res.error}`, false);
  loadSections();
});

// ---- Sync -------------------------------------------------------------------

async function renderSync() {
  const cfg = await getSyncConfig();
  $('sync-url').value = cfg.url || '';
  $('sync-token').value = cfg.token || '';
  $('device-name').value = (await getDevice()).name;
  await renderSyncStatus();
}

async function renderSyncStatus() {
  const state = await getSyncState();
  const cfg = await getSyncConfig();
  const el = $('sync-status');
  if (!cfg.url) return flash(el, 'Sync is off.', true);
  if (state.lastError && (state.lastErrorAt || 0) > (state.lastSyncAt || 0)) return flash(el, state.lastError, false);
  flash(el, state.lastSyncAt ? `Last synced ${ago(state.lastSyncAt)}` : 'Not synced yet');
}

$('save-sync').addEventListener('click', async () => {
  await setSyncConfig({ url: $('sync-url').value.trim(), token: $('sync-token').value.trim() });
  await setDeviceName($('device-name').value.trim() || (await getDevice()).id);
  flash($('sync-status'), 'Saved. Syncing…');
  await syncNow();
});

$('sync-now').addEventListener('click', syncNow);

async function syncNow() {
  flash($('sync-status'), 'Syncing…');
  const res = await chrome.runtime.sendMessage({ type: 'sync' });
  if (res.status === 'ok') flash($('sync-status'), `Synced: sent ${res.lastPushed}, received ${res.lastPulled}`);
  else if (res.status === 'off') flash($('sync-status'), 'Sync is off. Add a URL and token.', false);
  else flash($('sync-status'), res.error, false);
  renderDataStats();
  renderModes();
}

// ---- Data -------------------------------------------------------------------

async function renderDataStats() {
  const { total, pending } = await countEvents();
  $('data-stats').textContent = `${total} events stored on this device, ${pending} not yet synced.`;
}

$('export').addEventListener('click', async () => {
  const data = { exportedAt: new Date().toISOString(), settings: await allSettings(), events: await allEvents() };
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  h('a', { href: url, download: `block-sites-export-${Date.now()}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

renderModes();
loadSections();
renderSync();
renderDataStats();
