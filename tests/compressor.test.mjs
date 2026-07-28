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

test('large source searches are grouped while diagnostics stay visible', () => {
  const lines = Array.from({ length: 500 }, (_, index) => `src/worker.mjs:${index + 1}:const unique_${index} = ${index};`);
  lines[411] = 'src/worker.mjs:412:7:ERROR SEARCH-SENTINEL invalid branch';
  const result = compressToolResponse(lines.join('\n'), { budget: 2200 });
  assert.match(result.text, /SEARCH-SENTINEL/);
  assert.ok(result.collapsedLines > 450);
  assert.ok(result.text.length <= 2200);

  const small = compressToolResponse(Array.from({ length: 19 }, (_, index) => `src/file-${index}.mjs:${index + 1}:unique match`).join('\n'), { budget: 2200 });
  assert.equal(small.collapsedLines, 0);

  const diverse = compressToolResponse(Array.from({ length: 25 }, (_, index) => `src/pkg-${index}/file-${index}.mjs:${index + 1}:unique match`).join('\n'), { budget: 2200 });
  assert.equal(diverse.collapsedLines, 0);
});

test('JSON is flattened and retains failures', () => {
  const raw = JSON.stringify({ 'build.jobs': Array.from({ length: 700 }, (_, i) => ({ id: i, status: i === 611 ? 'ERROR SENTINEL-611' : 'ok' })) });
  const result = compressToolResponse(raw, { budget: 4500 });
  assert.equal(result.format, 'json-paths');
  assert.match(result.text, /\$\["build\.jobs"\]/);
  assert.match(result.text, /SENTINEL-611/);
});

test('long JSON arrays sample across the whole payload and keep late failures', () => {
  const raw = JSON.stringify({
    rows: Array.from({ length: 25000 }, (_, index) => ({
      id: index,
      success: index !== 24990,
      message: index === 24991 ? 'ERROR LATE-JSON-SENTINEL' : `unique payload ${index}`,
    })),
  });
  const result = compressToolResponse(raw, { budget: 2600 });
  assert.match(result.text, /sampled \d+ of 25000 items/);
  assert.match(result.text, /LATE-JSON-SENTINEL/);
  assert.match(result.text, /\[24990\]\.success = false/);
  assert.match(result.text, /\[24999\]/);
  assert.ok(result.text.length <= 2600);
  assert.ok(result.collapsedLines > 20);
});

test('duplicate MCP structured text is represented once', () => {
  const structuredContent = {
    summary: { status: 'ERROR MCP-DUP-SENTINEL', total: 1000 },
    results: Array.from({ length: 1000 }, (_, index) => ({ id: index, status: index === 777 ? 'failed' : 'ok' })),
  };
  const response = {
    content: [
      { type: 'text', text: JSON.stringify(structuredContent) },
      { type: 'text', text: 'WARNING independent context' },
    ],
    structuredContent,
    isError: false,
  };
  const result = compressToolResponse(response, { budget: 6000 });
  assert.equal(result.originalChars, JSON.stringify(response, null, 2).length);
  assert.equal(result.text.match(/MCP-DUP-SENTINEL/g)?.length, 1);
  assert.match(result.text, /independent context/);
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
  const text = redactSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz password=hunter22 sk-abcdefghijklmnop ghp_abcdefghijklmnopqrstuvwxyz123456 xoxb-1234567890-secretvalue npm_abcdefghijklmnopqrstuvwxyz1234 eyJabcdefghijk.abcdefghijklmnop.qrstuvwxyz12345 {"client_secret":"top secret value","refresh_token":"refresh-me-123"} Authorization: Basic dXNlcjpwYXNzd29yZA== postgres://user:database-password@localhost/db');
  assert.doesNotMatch(text, /hunter22|abcdefghijklmnop|ghp_|xoxb-|npm_|eyJ|top secret|refresh-me|dXNlcj|database-password/);
  assert.match(text, /REDACTED/);
});

test('long diagnostic lines retain a middle failure', () => {
  const filler = Array.from({ length: 1200 }, (_, index) => `field${index % 17}=${String.fromCharCode(65 + index % 26)}-${index % 31}`).join(' ');
  const middle = Math.floor(filler.length / 2);
  const lines = Array.from({ length: 1000 }, (_, index) => `worker ${index % 7} processed ${index}`);
  lines[500] = `${filler.slice(0, middle)} ERROR MID-SENTINEL ${filler.slice(middle)}`;
  const result = compressToolResponse(lines.join('\n'), { budget: 2200 });
  assert.match(result.text, /MID-SENTINEL/);
  assert.ok(result.text.length <= 2200);
});

test('blank and decorative output does not consume the budget', () => {
  const result = compressToolResponse(Array.from({ length: 5000 }, (_, index) => index % 2 ? '' : '----------------').join('\n'), { budget: 6000 });
  assert.ok(result.text.length < 100);
});

test('zero-failure summaries do not trigger failure escalation', () => {
  assert.equal(containsFailureSignal('SUMMARY passed=120 failed=0 errors: 0; no errors; error-free'), false);
  assert.equal(containsFailureSignal('{"error":null,"failures":[],"success":true}'), false);
  assert.equal(containsFailureSignal('ERROR checkout failed'), true);
  assert.equal(containsFailureSignal('{"success":false}'), true);
  assert.equal(containsFailureSignal('exit code: 2'), true);
  assert.equal(containsFailureSignal('process exited with exit status 2'), true);
});

test('compression threshold honors an escalated failure budget', () => {
  const response = `ERROR build failed\n${'non-repeating detail '.repeat(400)}`;
  assert.equal(shouldCompress(response, DEFAULT_CONFIG, 'balanced'), true);
  assert.equal(shouldCompress(response, DEFAULT_CONFIG, 'balanced', 8100), false);
});
