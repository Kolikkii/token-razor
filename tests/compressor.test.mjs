import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CONFIG } from '../scripts/lib/config.mjs';
import { compressToolResponse, containsBinaryMedia, containsFailureSignal, redactSecrets, shouldCompress } from '../scripts/lib/compressor.mjs';

test('small results pass through', () => {
  assert.equal(shouldCompress('short', DEFAULT_CONFIG, 'balanced'), false);
});

test('multimodal results always pass through', () => {
  const response = { content: [{ type: 'image', mimeType: 'image/png', data: 'x'.repeat(20000) }] };
  assert.equal(containsBinaryMedia(response), true);
  assert.equal(shouldCompress(response, DEFAULT_CONFIG, 'balanced'), false);

  const cyclic = { type: 'text' };
  cyclic.self = cyclic;
  assert.equal(containsBinaryMedia(cyclic), false);
});

test('large logs keep critical signals and reduce size', () => {
  const lines = Array.from({ length: 2500 }, (_, index) => `2026-01-01 worker=${index % 8} processed item ${index}`);
  lines[1733] = 'FATAL payment pipeline failed: invariant BROKEN-1733';
  lines.push('SUMMARY: 2499 passed, 1 failed');
  const raw = lines.join('\n');
  const result = compressToolResponse(raw, { budget: 5000 });
  assert.match(result.text, /BROKEN-1733/);
  assert.match(result.text, /SUMMARY/);
  assert.ok(result.text.length < raw.length * 0.25);
  assert.ok(result.text.length <= 5000);
  assert.ok(result.collapsedLines > 2000);
});

test('normalized variants retain representative samples', () => {
  const raw = Array.from({ length: 1000 }, (_, index) => `worker ${index % 8} processed item ${index}`).join('\n');
  const result = compressToolResponse(raw, { budget: 3500 });
  assert.match(result.text, /normalized variants/);
  assert.match(result.text, /item 0/);
  assert.match(result.text, /item 999/);
  assert.ok(result.selectedLines >= 4);
});

test('JSON is flattened and retains failures', () => {
  const raw = JSON.stringify({ 'build.jobs': Array.from({ length: 700 }, (_, i) => ({ id: i, status: i === 611 ? 'ERROR SENTINEL-611' : 'ok' })) });
  const result = compressToolResponse(raw, { budget: 4500 });
  assert.equal(result.format, 'json-paths');
  assert.match(result.text, /\$\["build\.jobs"\]/);
  assert.match(result.text, /SENTINEL-611/);
});

test('exact rendering budget does not discard a late failure', () => {
  const lines = Array.from({ length: 1400 }, (_, index) => index % 7 === 0
    ? `warning shard ${index}: retry scheduled`
    : `worker ${index % 12} processed record ${index}`);
  lines[1291] = 'FATAL LATE-SENTINEL-1291 database invariant failed';
  const result = compressToolResponse(lines.join('\n'), { budget: 2200 });
  assert.ok(result.text.length <= 2200);
  assert.match(result.text, /LATE-SENTINEL-1291/);
  assert.doesNotMatch(result.text, /hard budget boundary/);
});

test('common credentials are redacted', () => {
  const text = redactSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz password=hunter22 sk-abcdefghijklmnop ghp_abcdefghijklmnopqrstuvwxyz123456 xoxb-1234567890-secretvalue npm_abcdefghijklmnopqrstuvwxyz1234 eyJabcdefghijk.abcdefghijklmnop.qrstuvwxyz12345');
  assert.doesNotMatch(text, /hunter22|abcdefghijklmnop|ghp_|xoxb-|npm_|eyJ/);
  assert.match(text, /REDACTED/);
});

test('zero-failure summaries do not trigger failure escalation', () => {
  assert.equal(containsFailureSignal('SUMMARY passed=120 failed=0 errors: 0; no errors; error-free'), false);
  assert.equal(containsFailureSignal('{"error":null,"failures":[],"success":true}'), false);
  assert.equal(containsFailureSignal('ERROR checkout failed'), true);
  assert.equal(containsFailureSignal('{"success":false}'), true);
  assert.equal(containsFailureSignal('exit code: 2'), true);
  assert.equal(containsFailureSignal('process exited with exit status 2'), true);
});
