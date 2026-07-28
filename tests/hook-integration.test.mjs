import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { restorePayload } from '../scripts/lib/archive.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runHook(input, dataDir, env = {}) {
  return spawnSync(process.execPath, [path.join(root, 'scripts', 'hook.mjs')], {
    cwd: root,
    encoding: 'utf8',
    input: JSON.stringify(input),
    env: { ...process.env, PLUGIN_ROOT: root, PLUGIN_DATA: dataDir, ...env },
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

test('disabled plugin does not rewrite tools or write turn state', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-razor-disabled-'));
  const file = path.join(dir, 'large.txt');
  fs.writeFileSync(file, 'line\n'.repeat(20000));
  const dataDir = path.join(dir, 'data');
  const preTool = runHook({
    hook_event_name: 'PreToolUse', cwd: dir, tool_input: { command: 'cat large.txt' },
  }, dataDir, { TOKEN_RAZOR_DISABLED: '1' });
  const prompt = runHook({
    hook_event_name: 'UserPromptSubmit', session_id: 's', turn_id: 't', cwd: dir, prompt: 'minimum tokens',
  }, dataDir, { TOKEN_RAZOR_DISABLED: '1' });
  assert.equal(preTool.stdout, '');
  assert.equal(prompt.stdout, '');
  assert.equal(fs.existsSync(dataDir), false);
  fs.rmSync(dir, { recursive: true });
});

test('metrics failure does not disable compression', t => {
  if (process.platform === 'win32') {
    t.skip('Windows symlink creation requires elevated privileges in some environments');
    return;
  }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-razor-hook-metrics-'));
  const metrics = path.join(dataDir, 'metrics');
  fs.mkdirSync(metrics);
  const target = path.join(dataDir, 'target');
  fs.writeFileSync(target, 'unchanged');
  const day = new Date().toISOString().slice(0, 10);
  fs.symlinkSync(target, path.join(metrics, `${day}.jsonl`));
  const original = Array.from({ length: 1800 }, (_, index) => `worker ${index % 5} processed item ${index}`).join('\n');
  const result = runHook({
    hook_event_name: 'PostToolUse', session_id: 's', turn_id: 't', cwd: root,
    tool_name: 'Bash', tool_input: { command: 'demo' }, tool_response: original,
  }, dataDir);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).continue, false);
  assert.match(result.stderr, /metrics warning/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'unchanged');
  fs.rmSync(dataDir, { recursive: true });
});

test('Stop clears turn state and returns a valid hook response', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-razor-hook-stop-'));
  runHook({
    hook_event_name: 'UserPromptSubmit', session_id: 'session', turn_id: 'turn', cwd: root,
    prompt: 'minimum tokens',
  }, dataDir);
  const result = runHook({ hook_event_name: 'Stop', session_id: 'session', cwd: root }, dataDir);
  assert.equal(result.stdout, '{}\n');
  assert.deepEqual(fs.readdirSync(path.join(dataDir, 'sessions')), []);
  fs.rmSync(dataDir, { recursive: true });
});

test('PostToolUse keeps the complete feedback inside the active budget', () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-razor-budget-'));
  let dataDir = rootDir;
  for (let index = 0; index < 6; index += 1) dataDir = path.join(dataDir, `long-data-directory-${String(index).repeat(60)}`);
  fs.mkdirSync(dataDir, { recursive: true });
  runHook({
    hook_event_name: 'UserPromptSubmit', session_id: 'budget-session', turn_id: 'budget-turn', cwd: root,
    prompt: 'minimum tokens',
  }, dataDir);
  const lines = Array.from({ length: 5000 }, (_, index) => `src/pkg-${index % 30}/file-${index}.ts:${index % 300 + 1}: const value${index} = factory();`);
  lines.push('SUMMARY total=5000');
  const result = runHook({
    hook_event_name: 'PostToolUse', session_id: 'budget-session', turn_id: 'budget-turn', cwd: root,
    tool_name: 'Bash', tool_input: { command: 'search' }, tool_response: lines.join('\n'),
  }, dataDir);
  const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
  assert.ok(context.length <= 3200, `${context.length} > 3200`);
  assert.equal(context.split(dataDir).length - 1, 1);
  assert.match(context, /replace .*restore/);
  assert.match(context, /SUMMARY/);
  fs.rmSync(rootDir, { recursive: true });
});
