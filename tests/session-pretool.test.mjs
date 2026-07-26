import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../scripts/lib/config.mjs';
import { rewriteLargeCat } from '../scripts/lib/pretool.mjs';
import { appendMetric, classifyPrompt, cleanupMetrics, cleanupSessionModes, clearSessionModes, readSessionMode, writeSessionMode } from '../scripts/lib/session.mjs';

test('prompt intent selects an explicit mode', () => {
  assert.equal(classifyPrompt('Покажи полный вывод без сокращений'), 'passthrough');
  assert.equal(classifyPrompt('Максимально экономь токены'), 'extreme');
  assert.equal(classifyPrompt('Улучши экономию токенов до максимума'), 'extreme');
  assert.equal(classifyPrompt('Minimize token usage for this task'), 'extreme');
  assert.equal(classifyPrompt('Не теряй детали, safe mode'), 'safe');
});

test('only a simple large cat command is rewritten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-razor-cat-'));
  const file = path.join(dir, 'large.txt');
  const spaced = path.join(dir, 'large file.txt');
  fs.writeFileSync(file, 'line\n'.repeat(20000));
  fs.writeFileSync(spaced, 'line\n'.repeat(20000));
  const rewritten = rewriteLargeCat('cat large.txt', dir, DEFAULT_CONFIG, '/plugin');
  assert.match(rewritten, /cli\.mjs.*slice/);
  assert.match(rewriteLargeCat("cat 'large file.txt'", dir, DEFAULT_CONFIG, '/plugin'), /large file\.txt/);
  assert.equal(rewriteLargeCat('cat large file.txt', dir, DEFAULT_CONFIG, '/plugin'), null);
  assert.equal(rewriteLargeCat('cat large.txt | grep x', dir, DEFAULT_CONFIG, '/plugin'), null);
  fs.rmSync(dir, { recursive: true });
});

test('per-turn modes do not overwrite each other', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-razor-turns-'));
  writeSessionMode(dir, 'session', 'turn-a', 'safe');
  writeSessionMode(dir, 'session', 'turn-b', 'extreme');
  assert.equal(readSessionMode(dir, 'session', 'turn-a', 'balanced'), 'safe');
  assert.equal(readSessionMode(dir, 'session', 'turn-b', 'balanced'), 'extreme');
  clearSessionModes(dir, 'session');
  assert.equal(readSessionMode(dir, 'session', 'turn-a', 'balanced'), 'balanced');
  fs.rmSync(dir, { recursive: true });
});

test('abandoned turn state expires', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-razor-turn-expiry-'));
  writeSessionMode(dir, 'old-session', 'old-turn', 'safe');
  const stateRoot = path.join(dir, 'sessions');
  const [sessionName] = fs.readdirSync(stateRoot);
  const sessionPath = path.join(stateRoot, sessionName);
  const [stateName] = fs.readdirSync(sessionPath);
  const stateFile = path.join(sessionPath, stateName);
  const expired = new Date(Date.now() - 48 * 60 * 60 * 1000);
  fs.utimesSync(stateFile, expired, expired);
  cleanupSessionModes(dir, 24);
  assert.equal(readSessionMode(dir, 'old-session', 'old-turn', 'balanced'), 'balanced');
  fs.rmSync(dir, { recursive: true });
});

test('expired metric files are pruned without following symlinks', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-razor-metrics-'));
  const metrics = path.join(dir, 'metrics');
  fs.mkdirSync(metrics);
  const expired = path.join(metrics, '2020-01-01.jsonl');
  fs.writeFileSync(expired, '{}\n');
  fs.utimesSync(expired, new Date('2020-01-01'), new Date('2020-01-01'));
  cleanupMetrics(dir, 30);
  assert.equal(fs.existsSync(expired), false);
  if (process.platform !== 'win32') {
    const target = path.join(dir, 'outside.jsonl');
    const link = path.join(metrics, '2020-02-02.jsonl');
    fs.writeFileSync(target, '{"keep":true}\n');
    fs.symlinkSync(target, link);
    cleanupMetrics(dir, 30);
    assert.equal(fs.readFileSync(target, 'utf8'), '{"keep":true}\n');
    assert.equal(fs.lstatSync(link).isSymbolicLink(), true);
  } else t.diagnostic('Symlink behavior covered on POSIX CI');
  fs.rmSync(dir, { recursive: true });
});

test('metric writes do not follow a pre-existing symlink', t => {
  if (process.platform === 'win32') {
    t.skip('Windows symlink creation requires elevated privileges in some environments');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-razor-metric-link-'));
  const metrics = path.join(dir, 'metrics');
  const target = path.join(dir, 'target');
  fs.mkdirSync(metrics);
  fs.writeFileSync(target, 'unchanged');
  const day = new Date().toISOString().slice(0, 10);
  fs.symlinkSync(target, path.join(metrics, `${day}.jsonl`));
  assert.throws(() => appendMetric(dir, { originalChars: 10 }), /ELOOP|symbolic link|Unsafe/i);
  assert.equal(fs.readFileSync(target, 'utf8'), 'unchanged');
  fs.rmSync(dir, { recursive: true });
});
