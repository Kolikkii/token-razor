import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_CONFIG, mergeConfig, validateConfig } from '../scripts/lib/config.mjs';

test('malformed nested config falls back without throwing', () => {
  const config = validateConfig({ budgets: null, archive: 'disabled', smallResponseChars: false });
  assert.deepEqual(config.budgets, DEFAULT_CONFIG.budgets);
  assert.deepEqual(config.archive, DEFAULT_CONFIG.archive);
  assert.equal(config.smallResponseChars, DEFAULT_CONFIG.smallResponseChars);
});

test('config merge ignores unknown and prototype keys', () => {
  const input = JSON.parse('{"mode":"extreme","unknown":1,"__proto__":{"polluted":true}}');
  const config = mergeConfig(DEFAULT_CONFIG, input);
  assert.equal(config.mode, 'extreme');
  assert.equal(Object.hasOwn(config, 'unknown'), false);
  assert.equal(Object.hasOwn(config, '__proto__'), false);
  assert.equal({}.polluted, undefined);
});

test('nested defaults cannot be mutated by consumers', () => {
  assert.equal(Object.isFrozen(DEFAULT_CONFIG.budgets), true);
  assert.equal(Object.isFrozen(DEFAULT_CONFIG.archive), true);
});
