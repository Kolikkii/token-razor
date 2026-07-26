import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('repository package validation passes', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'validate.mjs')], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /validation passed/);
});

test('CLI slice streams a bounded line range', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-razor-cli-slice-'));
  const file = path.join(dir, 'large.txt');
  fs.writeFileSync(file, Array.from({ length: 10000 }, (_, index) => `line ${index + 1}`).join('\n'));
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'cli.mjs'), 'slice', file, '--start', '5000', '--lines', '2'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^line 5000\nline 5001\n\[Token Razor:/);
  assert.doesNotMatch(result.stdout, /line 5002/);
  fs.rmSync(dir, { recursive: true });
});

test('CLI preview never inherits passthrough mode', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-razor-cli-preview-'));
  const file = path.join(dir, 'large.txt');
  fs.writeFileSync(path.join(dir, '.token-razor.json'), JSON.stringify({ mode: 'passthrough' }));
  fs.writeFileSync(file, Array.from({ length: 2000 }, (_, index) => `worker ${index % 5} processed ${index}`).join('\n'));
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'cli.mjs'), 'preview', file], { cwd: dir, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /mode=balanced/);
  assert.ok(result.stdout.length < fs.statSync(file).size);
  fs.rmSync(dir, { recursive: true });
});

test('CLI rejects a missing data directory value', () => {
  const result = spawnSync(process.execPath, [path.join(root, 'scripts', 'cli.mjs'), 'doctor', '--data-dir'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /requires PATH/);
});
