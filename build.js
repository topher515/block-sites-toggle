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
  const bare = domain.replace(/^\*\.:?/, '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `||${bare}^`;
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
  for (const file of ['popup.html', 'popup.js', 'blocked.html', 'blocked.css']) {
    fs.copyFileSync(path.join(srcDir, file), path.join(buildDir, file));
  }

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

