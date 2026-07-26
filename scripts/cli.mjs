#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { listArchives, restorePayload } from './lib/archive.mjs';
import { budgetFor, loadConfig } from './lib/config.mjs';
import { compressToolResponse } from './lib/compressor.mjs';
import { readMetrics } from './lib/session.mjs';

const ownRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function dataDir(args = process.argv.slice(2)) {
  const flag = args.indexOf('--data-dir');
  if (flag >= 0) {
    if (!args[flag + 1] || args[flag + 1].startsWith('--')) throw new Error('--data-dir requires PATH');
    return path.resolve(args[flag + 1]);
  }
  return process.env.PLUGIN_DATA || process.env.CLAUDE_PLUGIN_DATA || path.join(ownRoot, '.data');
}

function usage() {
  process.stdout.write(`Token Razor CLI\n\nUsage:\n  token-razor stats [--json] [--data-dir PATH]\n  token-razor preview FILE [--mode safe|balanced|extreme]\n  token-razor restore TR-XXXXXXXXXXXX [--raw] [--data-dir PATH]\n  token-razor archives [--data-dir PATH]\n  token-razor slice FILE [--start N] [--lines N]\n  token-razor doctor [--data-dir PATH]\n`);
}

function stats(args) {
  const rows = readMetrics(dataDir(args));
  const amount = value => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0;
  const total = rows.reduce((acc, row) => {
    acc.calls += 1;
    acc.original += amount(row.originalChars);
    acc.delivered += amount(row.deliveredChars);
    acc.tokens += amount(row.tokensSaved);
    return acc;
  }, { calls: 0, original: 0, delivered: 0, tokens: 0 });
  const percent = total.original ? Number(Math.max(0, 100 * (1 - total.delivered / total.original)).toFixed(1)) : 0;
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify({
      compressedCalls: total.calls,
      originalChars: total.original,
      deliveredChars: total.delivered,
      estimatedTokensAvoided: total.tokens,
      characterReductionPercent: percent,
    }, null, 2)}\n`);
    return;
  }
  process.stdout.write(`Compressed calls: ${total.calls}\nOriginal chars: ${total.original}\nDelivered chars: ${total.delivered}\nEstimated tokens avoided: ${total.tokens}\nCharacter reduction: ${percent}%\n`);
}

function preview(file, args) {
  const modeFlag = args.indexOf('--mode');
  const requestedMode = modeFlag >= 0 ? args[modeFlag + 1] : undefined;
  if (modeFlag >= 0 && !requestedMode) throw new Error('--mode requires safe, balanced, or extreme');
  if (requestedMode && !['safe', 'balanced', 'extreme'].includes(requestedMode)) throw new Error(`Unknown preview mode: ${requestedMode}`);
  const cfg = loadConfig(process.cwd(), dataDir(args));
  const mode = ['safe', 'balanced', 'extreme'].includes(requestedMode) ? requestedMode : cfg.mode === 'passthrough' ? 'balanced' : cfg.mode;
  const raw = fs.readFileSync(path.resolve(file), 'utf8');
  const result = compressToolResponse(raw, { budget: budgetFor(cfg, mode) });
  process.stdout.write(`[Token Razor preview] ${result.originalChars} → ${result.compressedChars} chars; mode=${mode}; estimated tokens avoided=${result.estimatedTokensSaved}\n\n${result.text}\n`);
}

function restore(id, raw, args) {
  const payload = restorePayload(dataDir(args), id);
  const value = raw ? payload : payload.toolResponse;
  process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  process.stdout.write('\n');
}

async function slice(file, args) {
  const startFlag = args.indexOf('--start');
  const linesFlag = args.indexOf('--lines');
  const positiveInt = (value, fallback) => Number.isFinite(Number(value)) ? Math.max(1, Math.trunc(Number(value))) : fallback;
  const start = positiveInt(startFlag >= 0 ? args[startFlag + 1] : 1, 1);
  const count = positiveInt(linesFlag >= 0 ? args[linesFlag + 1] : 240, 240);
  const input = fs.createReadStream(path.resolve(file), { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  const selected = [];
  let lineNumber = 0;
  let hasMore = false;
  try {
    for await (const line of lines) {
      lineNumber += 1;
      if (lineNumber < start) continue;
      if (selected.length < count) selected.push(line);
      else {
        hasMore = true;
        break;
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
  process.stdout.write(selected.join('\n'));
  if (hasMore) {
    process.stdout.write(`\n[Token Razor: showing lines ${start}-${start + selected.length - 1}; request another slice if needed]\n`);
  } else process.stdout.write('\n');
}

function doctor(args) {
  const resolvedDataDir = dataDir(args);
  const cfg = loadConfig(process.cwd(), resolvedDataDir);
  const checks = {
    node: process.version,
    nodeSupported: Number(process.versions.node.split('.')[0]) >= 20,
    pluginRoot: ownRoot,
    dataDir: resolvedDataDir,
    hooks: fs.existsSync(path.join(ownRoot, 'hooks', 'hooks.json')),
    manifest: fs.existsSync(path.join(ownRoot, '.codex-plugin', 'plugin.json')),
    config: cfg,
  };
  process.stdout.write(`${JSON.stringify(checks, null, 2)}\n`);
}

const [command, ...args] = process.argv.slice(2);
try {
  if (!command || command === 'help' || command === '--help') usage();
  else if (command === 'stats') stats(args);
  else if (command === 'preview' && args[0]) preview(args[0], args.slice(1));
  else if (command === 'restore' && args[0]) restore(args[0], args.includes('--raw'), args);
  else if (command === 'archives') process.stdout.write(`${JSON.stringify(listArchives(dataDir(args)), null, 2)}\n`);
  else if (command === 'slice' && args[0]) await slice(args[0], args.slice(1));
  else if (command === 'doctor') doctor(args);
  else {
    usage();
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`Token Razor: ${error.message}\n`);
  process.exitCode = 1;
}
