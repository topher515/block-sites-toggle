// Host page for the active mode. Blocked requests land here as
// blocked.html?from=<original url>.
import { getActiveMode, makeCtx } from './core/modes.js';
import { logEvent } from './core/store.js';

function blockedFromUrl() {
  const i = location.href.indexOf('?from=');
  if (i < 0) return null;
  const url = location.href.slice(i + '?from='.length);
  try {
    return { url, host: new URL(url).hostname.replace(/^www\./, '') };
  } catch {
    return { url, host: '' };
  }
}

async function main() {
  const blocked = blockedFromUrl();
  if (blocked && blocked.host) {
    await logEvent('core', 'blocked_visit', { host: blocked.host });
    document.getElementById('blocked-host').textContent = `Blocked ${blocked.host}`;
  }

  const mode = await getActiveMode();
  document.getElementById('mode-title').textContent = mode.title;
  const el = document.getElementById('mode');
  try {
    const ctx = await makeCtx(mode, { blocked });
    await mode.mount(el, ctx);
  } catch (err) {
    console.error(err);
    el.innerHTML = '<h1>Stay focused</h1><p class="error"></p>';
    el.querySelector('.error').textContent = `Mode "${mode.id}" failed to load: ${err.message}`;
  }
}

main();
