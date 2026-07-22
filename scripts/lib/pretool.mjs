import fs from 'node:fs';
import path from 'node:path';

function shellQuote(value) {
  if (process.platform === 'win32') return `'${String(value).replaceAll("'", "''")}'`;
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function rewriteLargeCat(command, cwd, config, pluginRoot) {
  if (typeof command !== 'string' || !pluginRoot) return null;
  const match = command.match(/^\s*cat\s+(?:--\s+)?(?:(["'])([^"'\r\n]+)\1|([A-Za-z0-9_./@+,.:=-]+))\s*$/);
  if (!match) return null;
  const quote = match[1];
  const requested = (match[2] ?? match[3]).trim();
  if (!requested || requested.startsWith('-')) return null;
  if (quote === '"' && /[$`\\]/.test(requested)) return null;
  const file = path.resolve(cwd, requested);
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  if (!stat.isFile() || stat.size <= config.largeCatBytes) return null;
  const cli = path.join(pluginRoot, 'scripts', 'cli.mjs');
  return `${shellQuote(process.execPath)} ${shellQuote(cli)} slice ${shellQuote(file)} --lines ${config.largeCatLines}`;
}
