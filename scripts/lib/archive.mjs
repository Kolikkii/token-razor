import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

function assertArchiveDir(dir) {
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe archive directory: ${dir}`);
}

function ensurePrivateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  assertArchiveDir(dir);
  try { fs.chmodSync(dir, 0o700); } catch { /* Windows does not expose POSIX modes. */ }
}

function archiveDir(dataDir) {
  return path.join(dataDir, 'archive');
}

function safeId(id) {
  const value = String(id).toUpperCase();
  if (!/^TR-[A-F0-9]{12}$/.test(value)) throw new Error(`Invalid archive id: ${id}`);
  return value;
}

function hashablePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  const copy = { ...payload };
  delete copy.archivedAt;
  return copy;
}

function archiveFiles(dir) {
  assertArchiveDir(dir);
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !/^TR-[A-F0-9]{12}\.json\.gz$/.test(entry.name)) continue;
    const file = path.join(dir, entry.name);
    try {
      const stat = fs.lstatSync(file);
      if (stat.isFile() && !stat.isSymbolicLink()) files.push({ file, name: entry.name, size: stat.size, mtime: stat.mtimeMs });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return files;
}

function readArchive(file, id) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Unsafe archive entry: ${id}`);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    if (!fs.fstatSync(descriptor).isFile()) throw new Error(`Unsafe archive entry: ${id}`);
    return fs.readFileSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

export function archivePayload(dataDir, payload, config) {
  if (!dataDir || !config.archive.enabled) return null;
  const serialized = JSON.stringify(payload);
  const identity = JSON.stringify(hashablePayload(payload));
  const id = `TR-${crypto.createHash('sha256').update(identity).digest('hex').slice(0, 12).toUpperCase()}`;
  const dir = archiveDir(dataDir);
  ensurePrivateDir(dir);
  cleanupArchives(dataDir, config);
  const file = path.join(dir, `${id}.json.gz`);
  try {
    fs.writeFileSync(file, zlib.gzipSync(serialized, { level: 6 }), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = restorePayload(dataDir, id);
    if (JSON.stringify(hashablePayload(existing)) !== identity) throw new Error(`Archive id collision: ${id}`);
  }
  cleanupArchives(dataDir, config);
  try {
    const stat = fs.lstatSync(file);
    return stat.isFile() && !stat.isSymbolicLink() ? id : null;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export function restorePayload(dataDir, id) {
  const normalized = safeId(id);
  const dir = archiveDir(dataDir);
  assertArchiveDir(dir);
  const file = path.join(dir, `${normalized}.json.gz`);
  const bytes = readArchive(file, normalized);
  return JSON.parse(zlib.gunzipSync(bytes).toString('utf8'));
}

export function listArchives(dataDir) {
  const dir = archiveDir(dataDir);
  try {
    return archiveFiles(dir)
      .map(item => ({ id: item.name.replace('.json.gz', ''), bytes: item.size, modifiedAt: new Date(item.mtime).toISOString() }))
      .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

export function cleanupArchives(dataDir, config) {
  const dir = archiveDir(dataDir);
  const ttlMs = config.archive.ttlHours * 60 * 60 * 1000;
  const maxBytes = config.archive.maxMiB * 1024 * 1024;
  let files;
  try {
    files = archiveFiles(dir);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  const now = Date.now();
  const retained = [];
  for (const item of files) {
    if (now - item.mtime > ttlMs) {
      try { fs.unlinkSync(item.file); } catch { /* Another hook may clean concurrently. */ }
    } else retained.push(item);
  }
  files = retained.sort((a, b) => a.mtime - b.mtime);
  let total = files.reduce((sum, item) => sum + item.size, 0);
  for (const item of files) {
    if (total <= maxBytes) break;
    try {
      fs.unlinkSync(item.file);
      total -= item.size;
    } catch { /* Best effort under concurrent cleanup. */ }
  }
}
