import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanText, compressToolResponse } from '../scripts/lib/compressor.mjs';

function random(seed = 0x51f15e) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

test('deterministic mixed-output fuzz stays within budget and keeps failures', () => {
  const next = random();
  for (let run = 0; run < 120; run += 1) {
    const count = 80 + Math.floor(next() * 900);
    const sentinelAt = 1 + Math.floor(next() * (count - 2));
    const sentinel = `FUZZ-SENTINEL-${run}`;
    const lines = Array.from({ length: count }, (_, index) => {
      if (index === sentinelAt) return `FATAL ${sentinel}: invariant failed`;
      if (index % 19 === 0) return `warning shard=${index % 11} retry=${index}`;
      if (index % 13 === 0) return `\u001b[31mworker ${index % 7}\u001b[0m processed ${index}`;
      return `worker ${index % 7} processed item ${index} value=${Math.floor(next() * 100000)}`;
    });
    const budget = 1400 + Math.floor(next() * 5600);
    const result = compressToolResponse(lines.join('\n'), { budget });
    const bodyBudget = Math.max(500, budget - 700);
    assert.ok(result.text.length <= bodyBudget, `run ${run}: ${result.text.length} > ${bodyBudget}`);
    assert.match(result.text, new RegExp(sentinel));
    assert.doesNotMatch(result.text, /\u001b/);
  }
});

test('text cleanup handles arbitrary Unicode and long blobs', () => {
  const input = `nul\u0000 emoji 😀 combining e\u0301 ${'A'.repeat(200)}\r\nend`;
  const cleaned = cleanText(input);
  assert.doesNotMatch(cleaned, /\u0000|\r/);
  assert.match(cleaned, /emoji 😀/);
  assert.match(cleaned, /BASE64/);
});
