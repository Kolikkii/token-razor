import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { archivePayload, listArchives, restorePayload } from '../scripts/lib/archive.mjs';
import { DEFAULT_CONFIG } from '../scripts/lib/config.mjs';

test('archive round-trips and uses stable content ids', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-razor-'));
  const payload = { archivedAt: '2026-01-01T00:00:00.000Z', toolName: 'Bash', toolResponse: 'full output' };
  const id = archivePayload(dir, payload, DEFAULT_CONFIG);
  const sameId = archivePayload(dir, { ...payload, archivedAt: '2026-02-01T00:00:00.000Z' }, DEFAULT_CONFIG);
  assert.match(id, /^TR-[A-F0-9]{12}$/);
  assert.equal(sameId, id);
  assert.deepEqual(restorePayload(dir, id), payload);
  assert.equal(listArchives(dir).length, 1);
  fs.rmSync(dir, { recursive: true });
});

test('restore rejects symlinked archive entries', t => {
  if (process.platform === 'win32') {
    t.skip('Windows symlink creation requires elevated privileges in some environments');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-razor-link-'));
  const payload = { toolName: 'Bash', toolResponse: 'sensitive output' };
  const id = archivePayload(dir, payload, DEFAULT_CONFIG);
  const archive = path.join(dir, 'archive', `${id}.json.gz`);
  const target = path.join(dir, 'target');
  fs.writeFileSync(target, 'not an archive');
  fs.unlinkSync(archive);
  fs.symlinkSync(target, archive);
  assert.throws(() => restorePayload(dir, id), /Unsafe archive entry/);
  assert.equal(listArchives(dir).length, 0);
  fs.rmSync(dir, { recursive: true });
});

test('archive operations reject a symlinked archive directory', t => {
  if (process.platform === 'win32') {
    t.skip('Windows symlink creation requires elevated privileges in some environments');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-razor-dir-link-'));
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'token-razor-dir-target-'));
  fs.symlinkSync(target, path.join(dir, 'archive'));
  assert.throws(() => archivePayload(dir, { toolResponse: 'x' }, DEFAULT_CONFIG), /Unsafe archive directory/);
  fs.rmSync(dir, { recursive: true });
  fs.rmSync(target, { recursive: true });
});

test('re-archiving expired content leaves a restorable id', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-razor-expired-'));
  const payload = { toolName: 'Bash', toolResponse: 'same output' };
  const id = archivePayload(dir, payload, DEFAULT_CONFIG);
  const file = path.join(dir, 'archive', `${id}.json.gz`);
  const expired = new Date(Date.now() - 48 * 60 * 60 * 1000);
  fs.utimesSync(file, expired, expired);
  assert.equal(archivePayload(dir, payload, DEFAULT_CONFIG), id);
  assert.deepEqual(restorePayload(dir, id), payload);
  fs.rmSync(dir, { recursive: true });
});

test('archive returns no id when the retention cap removes the new entry', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'token-razor-cap-'));
  const config = { ...DEFAULT_CONFIG, archive: { ...DEFAULT_CONFIG.archive, maxMiB: 0 } };
  assert.equal(archivePayload(dir, { toolResponse: 'output' }, config), null);
  assert.equal(listArchives(dir).length, 0);
  fs.rmSync(dir, { recursive: true });
});
