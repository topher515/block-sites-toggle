// Writes the dynamic blocking rules from current settings. Used by the service worker,
// and by the popup as a fallback when the service worker does not answer.
import { buildRules } from './rules.js';
import { getSections, getEnabled } from './settings.js';

export async function applyRulesNow() {
  const sections = await getSections();
  const enabled = await getEnabled(sections);
  const rules = buildRules(sections, enabled, chrome.runtime.getURL('blocked.html'));
  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: existing.map((r) => r.id),
    addRules: rules,
  });
}

// Permissions the manifest asks for but the browser has not granted. This happens when a
// browser keeps an old permission set after an unpacked reload (seen in Arc).
export async function missingPermissions() {
  const { permissions = [], host_permissions = [] } = chrome.runtime.getManifest();
  const missing = [];
  for (const p of permissions) if (!(await chrome.permissions.contains({ permissions: [p] }))) missing.push(p);
  for (const o of host_permissions) if (!(await chrome.permissions.contains({ origins: [o] }))) missing.push(o);
  return missing;
}
