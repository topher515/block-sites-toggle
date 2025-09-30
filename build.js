#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function writeText(filePath, contents) {
  fs.writeFileSync(filePath, contents, 'utf8');
}

function toHostPatterns(sites) {
  // Expand bare domains to MV3 host_permissions patterns
  const patterns = new Set();
  for (const site of sites) {
    if (site.startsWith('*.') || site.includes('://')) {
      patterns.add(site);
    } else if (site.split('.').length === 2) {
      patterns.add(`*://*.${site}/*`);
      patterns.add(`*://${site}/*`);
    } else {
      patterns.add(`*://*.${site}/*`);
    }
  }
  return [...patterns];
}

function toDnrFilter(domain) {
  // uBO-style urlFilter supported by MV3: ||domain^
  let bare = domain.trim();
  // Strip schemes including wildcard schemes
  bare = bare.replace(/^[a-z*]+:\/\//i, '');
  // Strip leading wildcard subdomain
  bare = bare.replace(/^\*\./, '');
  // Strip trailing /* or /
  bare = bare.replace(/\/\*$/, '');
  bare = bare.replace(/\/$/, '');
  return `||${bare}^`;
}

function humanizeSitePattern(pattern) {
  let s = pattern.trim();
  s = s.replace(/^[a-z*]+:\/\//i, '');
  s = s.replace(/^\*\./, '');
  s = s.replace(/\/\*$/, '');
  s = s.replace(/\/$/, '');
  return s;
}

function generatePopupHtml(config) {
  const buttonsHtml = config.sections
    .map((section, idx) => {
      const isEnabled = section.enabledByDefault !== false;
      const className = isEnabled ? 'on' : 'off';
      const stateText = isEnabled ? 'ON' : 'OFF';
      const maybeMargin = idx ? ' style="margin-top:8px;"' : '';
      return `    <div${maybeMargin}>
      <button id="toggle-${section.id}" class="${className}">${section.title}: ${stateText}</button>
    </div>`;
    })
    .join('\n');

  const sitesHtml = config.sections
    .map((section) => {
      const readable = section.sites.map(humanizeSitePattern).join(', ');
      return `    <small>${section.title}: ${readable}</small>`;
    })
    .join('\n');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>Blocker</title>
    <style>
      body { font: 14px -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif; margin: 0; padding: 14px 16px; min-width: 220px; }
      .status { font-weight: 600; margin-bottom: 8px; }
      button { padding: 8px 12px; border: 0; border-radius: 10px; cursor: pointer; }
      .on  { background: #1a73e8; color: #fff; }
      .off { background: #e8eaed; color: #222; }
      small { display:block; color:#667; margin-top:8px; }
    </style>
  </head>
  <body>
    <div class="status">Sections</div>
${buttonsHtml}
${sitesHtml}
    <script src="popup.js"></script>
  </body>
 </html>
`;
}

function generatePopupJs(config) {
  const sectionsData = config.sections.map((s) => ({
    id: s.id,
    title: s.title,
    enabledByDefault: s.enabledByDefault !== false
  }));

  return `(() => {
  const sections = ${JSON.stringify(sectionsData, null, 2)};
  const storageKeyFor = (id) => \`enabled_\${id}\`;
  const getButton = (id) => document.getElementById(\`toggle-\${id}\`);

  function render(buttonEl, title, enabled) {
    buttonEl.textContent = \`${'${'}title}: ${'${'}enabled ? 'ON' : 'OFF'}\`;
    buttonEl.className = enabled ? 'on' : 'off';
  }

  function getStates() {
    return new Promise((resolve) => {
      const keys = sections.map((s) => storageKeyFor(s.id));
      chrome.storage.local.get(keys, (res) => {
        const states = {};
        for (const s of sections) {
          const val = res[storageKeyFor(s.id)];
          states[s.id] = typeof val === 'boolean' ? val : !!s.enabledByDefault;
        }
        resolve(states);
      });
    });
  }

  function setState(id, enabled) {
    return new Promise((resolve) => chrome.storage.local.set({ [storageKeyFor(id)]: enabled }, resolve));
  }

  async function apply(states) {
    const enable = [];
    const disable = [];
    for (const s of sections) {
      if (states[s.id]) enable.push(s.id); else disable.push(s.id);
    }
    const ops = [];
    if (enable.length) ops.push(chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds: enable }));
    if (disable.length) ops.push(chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: disable }));
    await Promise.all(ops);
  }

  (async () => {
    const states = await getStates();
    for (const s of sections) {
      const btn = getButton(s.id);
      render(btn, s.title, states[s.id]);
      btn.addEventListener('click', async () => {
        const current = await getStates();
        const next = { ...current, [s.id]: !current[s.id] };
        await setState(s.id, next[s.id]);
        await apply(next);
        render(btn, s.title, next[s.id]);
      });
    }
    apply(states);
  })();
})();`;
}

function build(configPath) {
  const root = process.cwd();
  const srcDir = path.join(root, 'src');
  const buildDir = path.join(root, 'build');

  const config = readJson(configPath);

  // Collect sites across sections for host permissions
  const allSites = new Set();
  for (const section of config.sections) {
    for (const site of section.sites) allSites.add(site);
  }

  ensureDir(buildDir);

  // Copy static files from src → build
  for (const file of ['blocked.html', 'blocked.css']) {
    fs.copyFileSync(path.join(srcDir, file), path.join(buildDir, file));
  }

  // Generate popup from config
  writeText(path.join(buildDir, 'popup.html'), generatePopupHtml(config));
  writeText(path.join(buildDir, 'popup.js'), generatePopupJs(config));

  // Generate per-section rules files
  const ruleResources = [];
  for (const section of config.sections) {
    const rules = section.sites.map((site, idx) => ({
      id: idx + 1,
      priority: 1,
      action: { type: 'redirect', redirect: { extensionPath: '/blocked.html' } },
      condition: { urlFilter: toDnrFilter(site), resourceTypes: ['main_frame'] }
    }));

    const rulesFile = `rules_${section.id}.json`;
    writeJson(path.join(buildDir, rulesFile), rules);
    ruleResources.push({ id: section.id, enabled: !!section.enabledByDefault, path: rulesFile });
  }

  // Build manifest
  const manifestSrc = readJson(path.join(srcDir, 'manifest.json'));
  const manifest = {
    ...manifestSrc,
    name: config.name || manifestSrc.name,
    version: config.version || manifestSrc.version,
    description: config.description || manifestSrc.description,
    permissions: manifestSrc.permissions,
    host_permissions: toHostPatterns([...allSites]),
    declarative_net_request: { rule_resources: ruleResources },
    web_accessible_resources: manifestSrc.web_accessible_resources,
    action: manifestSrc.action
  };

  writeJson(path.join(buildDir, 'manifest.json'), manifest);
}

if (require.main === module) {
  const configPath = process.argv[2] || path.join(process.cwd(), 'config.json');
  build(configPath);
  console.log('Build completed. Output in ./build');
}

module.exports = { build };

