#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { archivePayload, cleanupArchives } from './lib/archive.mjs';
import { budgetFor, loadConfig } from './lib/config.mjs';
import { compressToolResponse, containsFailureSignal, shouldCompress } from './lib/compressor.mjs';
import { rewriteLargeCat } from './lib/pretool.mjs';
import { appendMetric, classifyPrompt, cleanupMetrics, cleanupSessionModes, clearSessionModes, readSessionMode, writeSessionMode } from './lib/session.mjs';

const ownRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readStdin() {
  const raw = fs.readFileSync(0, 'utf8').trim();
  return raw ? JSON.parse(raw) : {};
}

function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function archiveEnvelope(input) {
  return {
    archivedAt: new Date().toISOString(),
    toolName: input.tool_name,
    cwd: input.cwd,
    toolInput: input.tool_input,
    toolResponse: input.tool_response,
  };
}

function shellQuote(value) {
  const text = String(value);
  if (process.platform === 'win32') return `'${text.replaceAll("'", "''")}'`;
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function restoreCommand(cliPath, archiveId, dataDir) {
  const command = [process.execPath, cliPath, 'restore', archiveId, '--data-dir', dataDir].map(shellQuote).join(' ');
  return process.platform === 'win32' ? `& ${command}` : command;
}

function formatFeedback(compressed, mode, archiveId, cliPath, dataDir) {
  const prefix = [
    `[Token Razor] ${compressed.originalChars.toLocaleString('en-US')} → ${compressed.compressedChars.toLocaleString('en-US')} chars`,
    `(~${compressed.estimatedTokensSaved.toLocaleString('en-US')} tokens avoided; mode=${mode}; format=${compressed.format})`,
    compressed.collapsedLines ? `${compressed.collapsedLines.toLocaleString('en-US')} repetitive lines collapsed` : '',
    archiveId ? `Full local output: ${archiveId}` : 'Full-output archive unavailable',
  ].filter(Boolean).join(' ');
  const retrieval = archiveId
    ? `Retrieve only if omitted evidence is needed: ${restoreCommand(cliPath, archiveId, dataDir)}`
    : '';
  return `${prefix}\n${retrieval}\n\n${compressed.text}`.trim();
}

function postToolUse(input, config, dataDir, pluginRoot) {
  const mode = readSessionMode(dataDir, input.session_id, input.turn_id, config.mode);
  if (/(?:view_image|imagegen|audio|video)/i.test(input.tool_name || '')) return;
  const requestedBudget = budgetFor(config, mode);
  const budget = containsFailureSignal(input.tool_response)
    ? Math.min(config.budgets.safe, Math.ceil(requestedBudget * 1.35))
    : requestedBudget;
  if (!shouldCompress(input.tool_response, config, mode, budget)) return;
  let compressed = compressToolResponse(input.tool_response, { budget });
  const archiveId = archivePayload(dataDir, archiveEnvelope(input), config);
  const cliPath = path.join(pluginRoot, 'scripts', 'cli.mjs');
  let feedback = formatFeedback(compressed, mode, archiveId, cliPath, dataDir);
  if (feedback.length > budget) {
    compressed = compressToolResponse(input.tool_response, { budget: Math.max(1200, budget - (feedback.length - budget) - 32) });
    feedback = formatFeedback(compressed, mode, archiveId, cliPath, dataDir);
  }
  if (feedback.length > budget || feedback.length >= compressed.originalChars) return;
  if (config.metrics) {
    try {
      appendMetric(dataDir, {
        sessionId: input.session_id,
        tool: input.tool_name,
        mode,
        originalChars: compressed.originalChars,
        deliveredChars: feedback.length,
        tokensSaved: Math.max(0, Math.ceil((compressed.originalChars - feedback.length) / 4)),
        archiveId,
      });
    } catch (error) {
      process.stderr.write(`Token Razor metrics warning: ${error.message}\n`);
    }
  }
  writeJson({
    continue: false,
    stopReason: 'Large tool output replaced by a signal-preserving local summary.',
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext: feedback,
    },
  });
}

function main() {
  const input = readStdin();
  const dataDir = process.env.PLUGIN_DATA || process.env.CLAUDE_PLUGIN_DATA;
  const pluginRoot = process.env.PLUGIN_ROOT || process.env.CLAUDE_PLUGIN_ROOT || ownRoot;
  const config = loadConfig(input.cwd || process.cwd(), dataDir);
  const event = input.hook_event_name;
  if (!config.enabled) return;

  if (event === 'SessionStart') {
    cleanupSessionModes(dataDir);
    writeJson({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: 'Token Razor is active. Large tool results may be signal-compressed and labeled with TR-IDs. Restore a TR-ID only when omitted evidence is necessary; otherwise prefer narrow reads and reuse prior evidence.',
      },
    });
    return;
  }

  if (event === 'UserPromptSubmit') {
    const mode = classifyPrompt(input.prompt, config.mode);
    writeSessionMode(dataDir, input.session_id, input.turn_id, mode);
    return;
  }

  if (event === 'PreToolUse') {
    const rewritten = rewriteLargeCat(input.tool_input?.command, input.cwd || process.cwd(), config, pluginRoot);
    if (rewritten) {
      writeJson({
        hookSpecificOutput: {
          hookEventName: 'PreToolUse',
          permissionDecision: 'allow',
          updatedInput: { command: rewritten },
        },
      });
    }
    return;
  }

  if (event === 'PostToolUse') {
    postToolUse(input, config, dataDir, pluginRoot);
    return;
  }

  if (event === 'PostCompact' || event === 'Stop') {
    if (dataDir && config.archive.enabled) cleanupArchives(dataDir, config);
    if (dataDir && config.metrics) cleanupMetrics(dataDir, config.metricsRetentionDays);
    if (event === 'Stop') clearSessionModes(dataDir, input.session_id);
    cleanupSessionModes(dataDir);
    if (event === 'Stop') writeJson({});
  }
}

try {
  main();
} catch (error) {
  // A broken optimizer must not block the underlying tool or turn.
  process.stderr.write(`Token Razor hook warning: ${error.message}\n`);
  process.exitCode = 0;
}
