import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function digest(value) {
  return crypto.createHash('sha256').update(String(value || 'unknown')).digest('hex').slice(0, 20);
}

function sessionDir(dataDir, sessionId) {
  return path.join(dataDir, 'sessions', digest(sessionId));
}

function stateFile(dataDir, sessionId, turnId) {
  return path.join(sessionDir(dataDir, sessionId), `${digest(turnId || 'shared')}.json`);
}

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  assertPrivateDir(dir);
  try { fs.chmodSync(dir, 0o700); } catch { /* Windows does not expose POSIX modes. */ }
}

function assertPrivateDir(dir) {
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe state directory: ${dir}`);
}

function writePrivateFile(file, content, append = false) {
  try {
    if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`Unsafe state file: ${file}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const mode = append ? fs.constants.O_APPEND : fs.constants.O_TRUNC;
  const flags = fs.constants.O_WRONLY | fs.constants.O_CREAT | mode | (fs.constants.O_NOFOLLOW ?? 0);
  const descriptor = fs.openSync(file, flags, 0o600);
  try {
    if (!fs.fstatSync(descriptor).isFile()) throw new Error(`Unsafe state file: ${file}`);
    fs.writeFileSync(descriptor, content);
  } finally {
    fs.closeSync(descriptor);
  }
}

function readPrivateFile(file) {
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error(`Unsafe state file: ${file}`);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    if (!fs.fstatSync(descriptor).isFile()) throw new Error(`Unsafe state file: ${file}`);
    return fs.readFileSync(descriptor, 'utf8');
  } finally {
    fs.closeSync(descriptor);
  }
}

export function classifyPrompt(prompt, fallback = 'balanced') {
  const text = String(prompt ?? '');
  if (/\b(?:verbatim|unabridged|full raw|do not (?:truncate|compress|summari[sz]e|minimi[sz]e)|no (?:compression|truncation))\b/i.test(text) || /без сокращений|полный вывод|дословно|не (?:сжимай|сокращай)/i.test(text)) return 'passthrough';
  if (/\b(?:extreme|minimum tokens?|ultra terse|low[- ]token|token[- ]efficient)\b|\b(?:save|reduce|minimi[sz]e).{0,24}\btokens?\b/i.test(text) || /эконом[а-яё]*.*токен|миним[а-яё]*.*токен|максимально кратко/iu.test(text)) return 'extreme';
  if (/\b(?:safe mode|conservative)\b/i.test(text) || /не теряй детали|сохрани детали/i.test(text)) return 'safe';
  return fallback;
}

export function writeSessionMode(dataDir, sessionId, turnId, mode) {
  if (!dataDir) return;
  const file = stateFile(dataDir, sessionId, turnId);
  ensurePrivateDir(path.dirname(file));
  writePrivateFile(file, JSON.stringify({ turnId, mode, updatedAt: new Date().toISOString() }));
}

export function readSessionMode(dataDir, sessionId, turnId, fallback) {
  if (!dataDir) return fallback;
  try {
    assertPrivateDir(sessionDir(dataDir, sessionId));
    const state = JSON.parse(readPrivateFile(stateFile(dataDir, sessionId, turnId)));
    return state.turnId === turnId || !turnId ? state.mode : fallback;
  } catch {
    return fallback;
  }
}

export function clearSessionModes(dataDir, sessionId) {
  if (!dataDir) return;
  const dir = sessionDir(dataDir, sessionId);
  try {
    assertPrivateDir(dir);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && /^[a-f0-9]{20}\.json$/.test(entry.name)) fs.unlinkSync(path.join(dir, entry.name));
    }
    fs.rmdirSync(dir);
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTEMPTY') throw error;
  }
}

export function cleanupSessionModes(dataDir, retentionHours = 24) {
  if (!dataDir) return;
  const root = path.join(dataDir, 'sessions');
  const cutoff = Date.now() - retentionHours * 60 * 60 * 1000;
  try {
    assertPrivateDir(root);
    for (const session of fs.readdirSync(root, { withFileTypes: true })) {
      if (!session.isDirectory() || !/^[a-f0-9]{20}$/.test(session.name)) continue;
      const dir = path.join(root, session.name);
      if (fs.lstatSync(dir).isSymbolicLink()) continue;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !/^[a-f0-9]{20}\.json$/.test(entry.name)) continue;
        const file = path.join(dir, entry.name);
        const stat = fs.lstatSync(file);
        if (stat.isFile() && !stat.isSymbolicLink() && stat.mtimeMs < cutoff) fs.unlinkSync(file);
      }
      try { fs.rmdirSync(dir); } catch (error) { if (error?.code !== 'ENOTEMPTY') throw error; }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

export function appendMetric(dataDir, metric) {
  if (!dataDir) return;
  const dir = path.join(dataDir, 'metrics');
  ensurePrivateDir(dir);
  const day = new Date().toISOString().slice(0, 10);
  const safeMetric = { ...metric, at: new Date().toISOString() };
  if (safeMetric.sessionId) {
    safeMetric.session = crypto.createHash('sha256').update(String(safeMetric.sessionId)).digest('hex').slice(0, 12);
    delete safeMetric.sessionId;
  }
  writePrivateFile(path.join(dir, `${day}.jsonl`), `${JSON.stringify(safeMetric)}\n`, true);
}

export function readMetrics(dataDir) {
  const dir = path.join(dataDir, 'metrics');
  try {
    assertPrivateDir(dir);
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(entry => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(entry.name))
      .flatMap(entry => readPrivateFile(path.join(dir, entry.name)).split('\n').filter(Boolean).flatMap(line => {
        try { return [JSON.parse(line)]; } catch { return []; }
      }));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export function cleanupMetrics(dataDir, retentionDays = 30) {
  if (!dataDir) return;
  const dir = path.join(dataDir, 'metrics');
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  try {
    assertPrivateDir(dir);
    for (const name of fs.readdirSync(dir)) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue;
      const file = path.join(dir, name);
      const stat = fs.lstatSync(file);
      if (stat.isFile() && !stat.isSymbolicLink() && stat.mtimeMs < cutoff) fs.unlinkSync(file);
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}
