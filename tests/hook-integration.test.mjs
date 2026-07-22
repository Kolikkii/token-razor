import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { restorePayload } from '../scripts/lib/archive.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runHook(input, dataDir) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'hook.mjs')], {
    cwd: root,
    encoding: 'utf8',
    input: JSON.stringify(input),
    env: { ...process.env, PLUGIN_ROOT: root, PLUGIN_DATA: dataDir },
  });
}

test('PostToolUse replaces large text and archives the original response', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-razor-hook-'));
  const prompt = runHook({
    hook_event_name: 'UserPromptSubmit', session_id: 'session-1', turn_id: 'turn-1', cwd: root,
    prompt: 'Use extreme mode and minimum tokens.',
  }, dataDir);
  assert.equal(prompt.status, 0);
  assert.equal(prompt.stdout, '');

  const lines = Array.from({ length: 1800 }, (_, index) => `worker ${index % 5} processed item ${index}`);
  lines[1444] = 'ERROR HOOK-SENTINEL-1444';
  const original = lines.join('\n');
  const result = runHook({
    hook_event_name: 'PostToolUse', session_id: 'session-1', turn_id: 'turn-1', cwd: root,
    tool_name: 'Bash', tool_input: { command: 'demo' }, tool_response: original,
  }, dataDir);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.continue, false);
  const context = output.hookSpecificOutput.additionalContext;
  assert.match(context, /HOOK-SENTINEL-1444/);
  assert.match(context, /--data-dir/);
  const id = context.match(/TR-[A-F0-9]{12}/)?.[0];
  assert.ok(id);
  assert.equal(restorePayload(dataDir, id).toolResponse, original);
  fs.rmSync(dataDir, { recursive: true });
});

test('PostToolUse leaves small and multimodal responses untouched', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-razor-hook-pass-'));
  const small = runHook({
    hook_event_name: 'PostToolUse', session_id: 's', turn_id: 't', cwd: root,
    tool_name: 'Bash', tool_input: { command: 'echo ok' }, tool_response: 'ok',
  }, dataDir);
  assert.equal(small.stdout, '');
  const image = runHook({
    hook_event_name: 'PostToolUse', session_id: 's', turn_id: 't', cwd: root,
    tool_name: 'view_image', tool_input: {}, tool_response: { image_url: `data:image/png;base64,${'a'.repeat(9000)}` },
  }, dataDir);
  assert.equal(image.stdout, '');
  fs.rmSync(dataDir, { recursive: true });
});

test('invalid nested config values fall back instead of disabling the hook', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-razor-hook-config-'));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ budgets: null, archive: 'invalid' }));
  const original = Array.from({ length: 1200 }, (_, index) => `worker ${index % 4} processed ${index}`).join('\n');
  const result = runHook({
    hook_event_name: 'PostToolUse', session_id: 'config-session', turn_id: 'config-turn', cwd: root,
    tool_name: 'Bash', tool_input: { command: 'demo' }, tool_response: original,
  }, dataDir);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).continue, false);
  fs.rmSync(dataDir, { recursive: true });
});
