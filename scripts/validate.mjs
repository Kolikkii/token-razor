#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function fail(message) {
  failures.push(message);
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function json(relative) {
  try {
    return JSON.parse(read(relative));
  } catch (error) {
    fail(`${relative}: invalid JSON (${error.message})`);
    return {};
  }
}

function requireFile(relative) {
  if (!fs.existsSync(path.join(root, relative))) fail(`${relative}: missing required file`);
}

const manifest = json('.codex-plugin/plugin.json');
const pkg = json('package.json');
const hooks = json('hooks/hooks.json');
const marketplace = json('.agents/plugins/marketplace.json');

if (manifest.name !== 'token-razor') fail('plugin manifest name must be token-razor');
if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version || '')) fail('plugin manifest version must be semver');
if (manifest.version !== pkg.version) fail('plugin and package versions must match');
if (manifest.repository !== 'https://github.com/Kolikkii/token-razor') fail('plugin repository URL is stale');
if (Object.hasOwn(manifest, 'hooks')) fail('plugin manifest must rely on default hooks/hooks.json discovery for validator compatibility');
if (/[*?]/.test(pkg.scripts?.test || '')) fail('test script must not depend on shell glob expansion');

for (const relative of [
  'README.md', 'LICENSE', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md',
  'hooks/hooks.json', 'skills/minimize-token-usage/SKILL.md',
  'assets/icon.svg', 'assets/logo.svg', 'assets/logo-dark.svg',
]) requireFile(relative);

for (const asset of [manifest.interface?.composerIcon, manifest.interface?.logo, manifest.interface?.logoDark]) {
  if (!asset?.startsWith('./')) fail(`invalid asset path: ${asset}`);
  else requireFile(asset.slice(2));
}

if (JSON.stringify(manifest).includes('[TODO:')) fail('plugin manifest contains a TODO placeholder');
if (Object.keys(hooks).join(',') !== 'hooks') fail('hooks/hooks.json must have exactly one top-level hooks key');

const supportedEvents = new Set(['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostCompact', 'Stop']);
const groupKeys = new Set(['matcher', 'hooks']);
const handlerKeys = new Set(['type', 'command', 'commandWindows', 'timeout', 'statusMessage']);
for (const [event, groups] of Object.entries(hooks.hooks || {})) {
  if (!supportedEvents.has(event)) fail(`unsupported hook event: ${event}`);
  if (!Array.isArray(groups)) {
    fail(`${event}: hook groups must be an array`);
    continue;
  }
  for (const group of groups) {
    for (const key of Object.keys(group)) if (!groupKeys.has(key)) fail(`${event}: unsupported group key ${key}`);
    for (const handler of group.hooks || []) {
      for (const key of Object.keys(handler)) if (!handlerKeys.has(key)) fail(`${event}: unsupported handler key ${key}`);
      if (handler.type !== 'command') fail(`${event}: only command handlers are supported`);
      if (!handler.command?.includes('${PLUGIN_ROOT}')) fail(`${event}: POSIX command must resolve through PLUGIN_ROOT`);
      if (!handler.commandWindows?.includes('$env:PLUGIN_ROOT')) fail(`${event}: Windows command must resolve through PLUGIN_ROOT`);
    }
  }
}

const entry = marketplace.plugins?.find(item => item.name === 'token-razor');
if (marketplace.name !== 'token-razor' || !entry) fail('marketplace must expose token-razor');
if (entry?.source?.source !== 'url' || entry?.source?.url !== 'https://github.com/Kolikkii/token-razor.git') fail('marketplace Git source is invalid');
if (!entry?.policy?.installation || !entry?.policy?.authentication || !entry?.category) fail('marketplace policy metadata is incomplete');

const publicFiles = [
  'README.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md',
  'docs/architecture.md', 'docs/evaluation.md',
  'docs/performance.md',
  'skills/minimize-token-usage/SKILL.md',
  'skills/minimize-token-usage/references/algorithms-and-configuration.md',
];
for (const relative of publicFiles) {
  const source = read(relative);
  if (/\[TODO:|\bFIXME\b/.test(source)) fail(`${relative}: contains an unfinished placeholder`);
  if (/[\u0400-\u04FF]/.test(source)) fail(`${relative}: public documentation must be English-only`);
}

if (failures.length) {
  for (const failure of failures) process.stderr.write(`FAIL ${failure}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('Token Razor package validation passed.\n');
}
