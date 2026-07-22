import fs from 'node:fs';
import path from 'node:path';

const defaults = {
  enabled: true,
  mode: 'balanced',
  smallResponseChars: 4000,
  budgets: { safe: 8500, balanced: 6000, extreme: 3200 },
  archive: { enabled: true, ttlHours: 24, maxMiB: 64 },
  largeCatBytes: 80000,
  largeCatLines: 240,
  metrics: true,
  metricsRetentionDays: 30,
};

Object.freeze(defaults.budgets);
Object.freeze(defaults.archive);
export const DEFAULT_CONFIG = Object.freeze(defaults);

const MODES = new Set(['safe', 'balanced', 'extreme', 'passthrough']);

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function mergeConfig(base, override) {
  if (!isObject(override)) return structuredClone(base);
  const out = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    if (!Object.hasOwn(out, key)) continue;
    if (isObject(value) && isObject(out[key])) out[key] = mergeConfig(out[key], value);
    else out[key] = value;
  }
  return out;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw new Error(`Invalid Token Razor config at ${file}: ${error.message}`);
  }
}

function positiveInt(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  if (value == null || value === '' || typeof value === 'boolean') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, Math.trunc(parsed))) : fallback;
}

export function validateConfig(input) {
  const cfg = mergeConfig(DEFAULT_CONFIG, input);
  cfg.enabled = cfg.enabled !== false;
  cfg.mode = MODES.has(cfg.mode) ? cfg.mode : DEFAULT_CONFIG.mode;
  cfg.smallResponseChars = positiveInt(cfg.smallResponseChars, 4000, 1000, 200000);
  if (!isObject(cfg.budgets)) cfg.budgets = {};
  for (const mode of ['safe', 'balanced', 'extreme']) {
    cfg.budgets[mode] = positiveInt(cfg.budgets?.[mode], DEFAULT_CONFIG.budgets[mode], 1200, 100000);
  }
  if (!isObject(cfg.archive)) cfg.archive = {};
  cfg.archive.enabled = cfg.archive?.enabled !== false;
  cfg.archive.ttlHours = positiveInt(cfg.archive?.ttlHours, 24, 1, 720);
  cfg.archive.maxMiB = positiveInt(cfg.archive?.maxMiB, 64, 1, 4096);
  cfg.largeCatBytes = positiveInt(cfg.largeCatBytes, 80000, 10000, 1000000000);
  cfg.largeCatLines = positiveInt(cfg.largeCatLines, 240, 40, 5000);
  cfg.metrics = cfg.metrics !== false;
  cfg.metricsRetentionDays = positiveInt(cfg.metricsRetentionDays, 30, 1, 3650);
  return cfg;
}

export function loadConfig(cwd = process.cwd(), dataDir = process.env.PLUGIN_DATA) {
  let cfg = structuredClone(DEFAULT_CONFIG);
  if (dataDir) cfg = mergeConfig(cfg, readJson(path.join(dataDir, 'config.json')));
  cfg = mergeConfig(cfg, readJson(path.join(cwd, '.token-razor.json')));
  if (process.env.TOKEN_RAZOR_MODE) cfg.mode = process.env.TOKEN_RAZOR_MODE.trim().toLowerCase();
  if (process.env.TOKEN_RAZOR_DISABLED === '1') cfg.enabled = false;
  return validateConfig(cfg);
}

export function budgetFor(config, mode = config.mode) {
  if (mode === 'passthrough') return Number.MAX_SAFE_INTEGER;
  return config.budgets[mode] ?? config.budgets.balanced;
}
