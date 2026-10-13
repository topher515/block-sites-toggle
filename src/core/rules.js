// Blocking via dynamic declarativeNetRequest rules (pure; applied by background.js). Each blocked request is
// redirected to blocked.html?from=<original url>.

// '*://*.reddit.com/*', 'https://reddit.com', 'reddit.com' -> 'reddit.com'
export function siteToHost(site) {
  return site
    .trim()
    .toLowerCase()
    .replace(/^[a-z*]+:\/\//, '')
    .replace(/^\*\./, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '');
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Matches the host and any subdomain, over http or https.
export function hostRegex(host) {
  return `^https?://([^/?#]*\\.)?${escapeRegex(host)}([:/?#].*)?$`;
}

export function buildRules(sections, enabled, blockedPageUrl) {
  const hosts = new Set();
  for (const section of sections) {
    if (!enabled[section.id]) continue;
    for (const site of section.sites) {
      const host = siteToHost(site);
      if (host) hosts.add(host);
    }
  }
  return [...hosts].map((host, i) => ({
    id: i + 1,
    priority: 1,
    action: { type: 'redirect', redirect: { regexSubstitution: `${blockedPageUrl}?from=\\0` } },
    condition: { regexFilter: hostRegex(host), resourceTypes: ['main_frame'] },
  }));
}
