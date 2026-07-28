#!/usr/bin/env node
import assert from 'node:assert/strict';
import { compressToolResponse } from '../scripts/lib/compressor.mjs';

function logFixture() {
  const lines = Array.from({ length: 6000 }, (_, i) => `2026-07-22T12:${String(i % 60).padStart(2, '0')}:00Z worker=${i % 12} processed request ${i} in ${20 + (i % 9)}ms`);
  lines[4321] = 'ERROR checkout failed code=E-CHECKOUT-4321 retry=false';
  lines.push('SUMMARY passed=5999 failed=1');
  return { name: 'repetitive-log', value: lines.join('\n'), markers: ['E-CHECKOUT-4321', 'SUMMARY'] };
}

function jsonFixture() {
  const value = { results: Array.from({ length: 1800 }, (_, i) => ({ id: i, path: `src/module-${i % 40}/file-${i}.ts`, status: i === 1207 ? 'FAILED J-1207' : 'ok', durationMs: i % 17 })) };
  return { name: 'large-json', value, markers: ['J-1207'] };
}

function searchFixture() {
  const lines = Array.from({ length: 5000 }, (_, i) => `src/pkg-${i % 30}/file-${i}.ts:${i % 300 + 1}: const repeatedValue${i} = factory();`);
  lines[3888] = 'src/security/auth.ts:91: throw new Error("AUTH-SENTINEL-3888")';
  return { name: 'search-results', value: lines.join('\n'), markers: ['AUTH-SENTINEL-3888'] };
}

const rows = [];
for (const fixture of [logFixture(), jsonFixture(), searchFixture()]) {
  const result = compressToolResponse(fixture.value, { budget: 6000 });
  for (const marker of fixture.markers) assert.match(result.text, new RegExp(marker));
  rows.push({
    fixture: fixture.name,
    originalChars: result.originalChars,
    deliveredChars: result.text.length,
    reduction: `${(100 * (1 - result.text.length / result.originalChars)).toFixed(1)}%`,
    estimatedTokensSaved: result.estimatedTokensSaved,
    signals: 'kept',
  });
}

console.table(rows);
const originalTotal = rows.reduce((sum, row) => sum + row.originalChars, 0);
const deliveredTotal = rows.reduce((sum, row) => sum + row.deliveredChars, 0);
console.log(`Weighted character reduction: ${(100 * (1 - deliveredTotal / originalTotal)).toFixed(1)}%`);
console.log('Scope: synthetic PostToolUse microbenchmark; not an end-to-end session claim.');
