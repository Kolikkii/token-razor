import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const ANSI_RE = /[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const BASE64_RE = /(?:[A-Za-z0-9+/]{80,}={0,2})/g;
const FAILURE_RE = /\b(?:fatal|panic|exception|traceback|segfault|error|fail(?:ed|ure)?|assert(?:ion)?|timed?\s*out)\b/i;
const IMPORTANT_RE = /\b(?:warn(?:ing)?|deprecated|retry|timeout|summary|result|total|passed|success|exit(?:ed)?|status|changed|modified)\b/i;
const NOISE_RE = /^(?:\s*|[\s|`~_*=-]{12,})$/;
const SECRET_KEY = '(?:password|passwd|api[_-]?key|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|private[_-]?token|secret)';
const SECRET_RULES = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]'],
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED_OPENAI_KEY]'],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[REDACTED_GITHUB_TOKEN]'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED_SLACK_TOKEN]'],
  [/\bglpat-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_GITLAB_TOKEN]'],
  [/\bnpm_[A-Za-z0-9]{20,}\b/g, '[REDACTED_NPM_TOKEN]'],
  [/\bAIza[A-Za-z0-9_-]{30,}\b/g, '[REDACTED_GOOGLE_KEY]'],
  [/\bAKIA[A-Z0-9]{16}\b/g, '[REDACTED_AWS_KEY]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]'],
  [/\b(Bearer\s+)[A-Za-z0-9._~+\/-]{16,}/gi, '$1[REDACTED]'],
  [/\b(Basic\s+)[A-Za-z0-9+/=]{8,}/gi, '$1[REDACTED]'],
  [/\b((?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/@]+:)[^@\s/]+@/gi, '$1[REDACTED]@'],
  [new RegExp(`\\b(${SECRET_KEY})(["']?\\s*[:=]\\s*)(["'])(?:\\\\.|(?!\\3)[^\\r\\n])*\\3`, 'gi'), '$1$2$3[REDACTED]$3'],
  [new RegExp(`\\b(${SECRET_KEY})(["']?\\s*[:=]\\s*)([^\\s,;}\\]]{6,})`, 'gi'), '$1$2[REDACTED]'],
];

function shortHash(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 12);
}

export function redactSecrets(text) {
  let out = String(text);
  for (const [pattern, replacement] of SECRET_RULES) out = out.replace(pattern, replacement);
  return out;
}

export function cleanText(value) {
  return redactSecrets(String(value ?? ''))
    .replace(ANSI_RE, '')
    .replace(CONTROL_RE, '')
    .replace(BASE64_RE, token => `[BASE64 ${token.length} chars sha256:${shortHash(token)}]`)
    .replace(/\r\n?/g, '\n');
}

function dedupeStructuredText(response) {
  if (!response || Array.isArray(response) || response.structuredContent == null || !Array.isArray(response.content)) return response;
  return {
    ...response,
    content: response.content.map(item => {
      if (item?.type !== 'text' || typeof item.text !== 'string') return item;
      try {
        return isDeepStrictEqual(JSON.parse(item.text), response.structuredContent)
          ? { ...item, text: '[duplicate of $.structuredContent]' }
          : item;
      } catch {
        return item;
      }
    }),
  };
}

function responseToText(response) {
  if (typeof response === 'string') return response;
  if (response == null) return '';
  try {
    return JSON.stringify(response, null, 2);
  } catch {
    return String(response);
  }
}

const MAX_JSON_PATHS = 20000;

function jsonPath(parent, key) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function sampledArrayIndexes(value, maxItems) {
  if (value.length <= maxItems) return null;
  const indexes = new Set();
  const signalLimit = Math.floor(maxItems / 2);
  const signals = [];
  for (let index = 0; index < value.length; index += 1) {
    let text;
    try {
      text = typeof value[index] === 'string' ? value[index] : JSON.stringify(value[index]);
    } catch {
      continue;
    }
    if (FAILURE_RE.test(withoutBenignFailures(text)) || hasNegativeStatus(text)) signals.push(index);
  }
  const signalSamples = Math.min(signalLimit, signals.length);
  for (let sample = 0; sample < signalSamples; sample += 1) {
    indexes.add(signals[Math.round(sample * (signals.length - 1) / Math.max(1, signalSamples - 1))]);
  }
  const coverageSamples = maxItems - indexes.size;
  for (let sample = 0; sample < coverageSamples; sample += 1) {
    indexes.add(Math.round(sample * (value.length - 1) / Math.max(1, coverageSamples - 1)));
  }
  return [...indexes].sort((a, b) => a - b);
}

function flattenJson(value, path = '$', depth = 0, out = [], arraySamples = 64) {
  if (out.length >= MAX_JSON_PATHS) return true;
  if (depth > 9) {
    out.push(`${path} = [depth limit]`);
    return false;
  }
  if (Array.isArray(value)) {
    out.push(`${path}.length = ${value.length}`);
    const indexes = sampledArrayIndexes(value, arraySamples);
    if (indexes) out.push(`${path} = [sampled ${indexes.length} of ${value.length} items; failures prioritized]`);
    for (const index of indexes ?? value.keys()) {
      if (flattenJson(value[index], `${path}[${index}]`, depth + 1, out, arraySamples)) return true;
    }
  } else if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    if (entries.length === 0) out.push(`${path} = {}`);
    for (const [key, item] of entries) {
      if (flattenJson(item, jsonPath(path, key), depth + 1, out, arraySamples)) return true;
    }
  } else {
    const rendered = JSON.stringify(value);
    out.push(`${path} = ${rendered}`);
  }
  return false;
}

function maybeFlattenJson(text, arraySamples) {
  const trimmed = text.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null;
  try {
    const value = JSON.parse(trimmed);
    const lines = [];
    if (flattenJson(value, '$', 0, lines, arraySamples)) lines.push(`$ = [flattening stopped after ${MAX_JSON_PATHS.toLocaleString('en-US')} paths]`);
    return lines.join('\n');
  } catch {
    return null;
  }
}

export function clipLine(line, max = 900) {
  if (line.length <= max) return line;
  const marker = ` … [${line.length} chars; sha256:${shortHash(line)}] … `;
  const room = max - marker.length;
  const failure = line.search(FAILURE_RE);
  const signal = failure >= 0 ? failure : line.search(IMPORTANT_RE);
  if (signal >= 0) {
    const separator = ' … ';
    const edge = Math.floor((room - separator.length) / 5);
    const middle = room - separator.length - edge * 2;
    const start = Math.max(edge, Math.min(signal - Math.floor(middle / 3), line.length - edge - middle));
    return `${line.slice(0, edge)}${separator}${line.slice(start, start + middle)}${marker}${line.slice(-edge)}`;
  }
  const half = Math.floor(room / 2);
  return `${line.slice(0, half)}${marker}${line.slice(-half)}`;
}

function fingerprint(line) {
  const normalized = line.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/\b(?:fatal|panic|exception|traceback|segfault|error|fail(?:ed|ure)?|assert(?:ion)?|warn(?:ing)?)\b/i.test(line)) {
    return normalized
      .replace(/\b\d{4}-\d{2}-\d{2}[t ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?z?\b/g, '#time')
      .replace(/0x[0-9a-f]+/g, '0x#');
  }
  if (hasNegativeStatus(line)) return normalized;
  const jsonAssignment = line.match(/^(\$.*?) = /);
  if (jsonAssignment) return `json:${jsonAssignment[1].replace(/\[\d+\]/g, '[#]')}`;
  const sourceLocation = line.match(/^((?:[A-Za-z]:)?[^:\n]*[\\/][^:\n\\/]+\.[A-Za-z0-9]{1,10}|[^:\n\\/]+\.[A-Za-z0-9]{1,10}):\d+(?::\d+)?:/);
  if (sourceLocation) return `location:${sourceLocation[1].replaceAll('\\', '/').toLowerCase()}`;
  return line
    .toLowerCase()
    .replace(/0x[0-9a-f]+/g, '0x#')
    .replace(/\b[0-9a-f]{8,}\b/g, '#hex')
    .replace(/\b\d+(?:\.\d+)?\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function withoutBenignFailures(text) {
  return text
    .replace(/["']?(?:failed|failures?|errors?)["']?\s*[:=]\s*(?:0|false|null|none|\[\]|\{\}|["']{2})/gi, '')
    .replace(/\b0\s+(?:failed|failures?|errors?)\b/gi, '')
    .replace(/\b(?:no|without)\s+(?:errors?|failures?)\b/gi, '')
    .replace(/\berror[- ]free\b/gi, '');
}

function hasNegativeStatus(text) {
  return /["']?(?:success|ok)["']?\s*[:=]\s*false\b/i.test(text)
    || /["']?exit(?:[ _-]?(?:code|status))?["']?\s*(?:[:=]\s*|\s+)[1-9]\d*\b/i.test(text);
}

function lineScore(line, index, total) {
  const failureText = withoutBenignFailures(line);
  let score = 0;
  if (/\b(fatal|panic|exception|traceback|segfault|error)\b/i.test(failureText)) score += 130;
  if (/\b(fail(?:ed|ure)?|assert(?:ion)?|reject(?:ed)?)\b/i.test(failureText)) score += 115;
  if (hasNegativeStatus(line)) score += 125;
  if (/\b(warn(?:ing)?|deprecated|retry|timeout)\b/i.test(line)) score += 85;
  if (/\b(summary|result|total|passed|success|exit(?:ed)?|status|changed|modified)\b/i.test(line)) score += 60;
  if (/^(diff --git|@@|\+\+\+|---)|\b(test|spec)\b/i.test(line)) score += 42;
  if (/(?:^|\s)(?:[A-Za-z]:)?[^\s:]+\/[\w@.+-]+(?:\.\w+)?(?::\d+)?/.test(line)) score += 24;
  if (NOISE_RE.test(line)) score -= 20;
  if (index < 20 || index >= total - 20) score += 18;
  return score;
}

function collapseNearDuplicates(lines) {
  const groups = new Map();
  const keys = lines.map(line => fingerprint(line));
  lines.forEach((line, index) => {
    const key = keys[index];
    if (!key) return;
    const current = groups.get(key) ?? [];
    current.push(index);
    groups.set(key, current);
  });

  const retained = new Map();
  let duplicateGroups = 0;
  let collapsedLines = 0;
  for (const [key, indexes] of groups) {
    if (indexes.length === 1) continue;
    if (key.startsWith('location:') && indexes.length < 20) {
      groups.delete(key);
      continue;
    }
    duplicateGroups += 1;
    const keep = new Set([indexes[0], indexes.at(-1)]);
    if (indexes.length >= 6) {
      keep.add(indexes[Math.floor(indexes.length / 3)]);
      keep.add(indexes[Math.floor((indexes.length * 2) / 3)]);
    }
    collapsedLines += indexes.length - keep.size;
    for (const index of keep) retained.set(index, { first: indexes[0], count: indexes.length, samples: keep.size });
  }

  return {
    lines: lines.map((line, index) => {
      const group = groups.get(keys[index]);
      if (!group || group.length === 1) return line;
      const info = retained.get(index);
      if (!info) return null;
      if (index === info.first) return `${line}  [×${info.count} normalized variants; ${info.samples} samples retained]`;
      return line;
    }),
    duplicateGroups,
    collapsedLines,
  };
}

function chooseLines(lines, charBudget) {
  const selected = new Set();
  const costs = lines.map(line => (line == null ? 0 : line.length + 1));
  let used = 0;
  const add = index => {
    if (index < 0 || index >= lines.length || selected.has(index) || lines[index] == null || NOISE_RE.test(lines[index])) return false;
    if (used + costs[index] > charBudget) return false;
    selected.add(index);
    used += costs[index];
    return true;
  };

  const ranked = lines
    .map((line, index) => ({ index, score: line == null ? -Infinity : lineScore(line, index, lines.length) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
  for (const item of ranked) {
    if (item.score < 80 || used >= charBudget * 0.65) break;
    add(item.index);
  }

  const edgeCount = Math.min(18, Math.ceil(lines.length * 0.03));
  for (let i = 0; i < edgeCount; i += 1) add(i);
  for (let i = Math.max(0, lines.length - edgeCount); i < lines.length; i += 1) add(i);

  for (const item of ranked) {
    if (used >= charBudget * 0.9) break;
    if (item.score < 20 && selected.size > 30) break;
    add(item.index);
  }

  const stride = Math.max(1, Math.floor(lines.length / 24));
  for (let i = 0; i < lines.length && used < charBudget; i += stride) add(i);
  for (let i = 0; i < lines.length && used < charBudget; i += 1) add(i);
  return [...selected].sort((a, b) => a - b);
}

function renderSelection(lines, selected) {
  const out = [];
  let previous = -1;
  for (const index of selected) {
    const omitted = index - previous - 1;
    if (omitted > 0) out.push(`… [omitted ${omitted} line${omitted === 1 ? '' : 's'}] …`);
    out.push(lines[index]);
    previous = index;
  }
  const tail = lines.length - previous - 1;
  if (tail > 0) out.push(`… [omitted ${tail} line${tail === 1 ? '' : 's'}] …`);
  return out.join('\n');
}

function fitSelection(lines, selected, charBudget) {
  const retained = new Set(selected);
  let rendered = renderSelection(lines, [...retained].sort((a, b) => a - b));
  if (rendered.length <= charBudget) return { text: rendered, selected: [...retained] };

  const removalOrder = [...retained]
    .map(index => ({ index, score: lineScore(lines[index], index, lines.length) }))
    .sort((a, b) => a.score - b.score || b.index - a.index);
  for (const item of removalOrder) {
    if (retained.size <= 1) break;
    retained.delete(item.index);
    rendered = renderSelection(lines, [...retained].sort((a, b) => a - b));
    if (rendered.length <= charBudget) return { text: rendered, selected: [...retained] };
  }

  if (rendered.length > charBudget) rendered = clipLine(rendered, charBudget);
  return { text: rendered, selected: [...retained] };
}

export function estimateTokens(chars) {
  return Math.ceil(chars / 4);
}

export function containsFailureSignal(response) {
  const text = withoutBenignFailures(responseToText(dedupeStructuredText(response)));
  return FAILURE_RE.test(text)
    || hasNegativeStatus(text);
}

function hasBinaryMedia(value, depth, seen) {
  if (depth > 6 || value == null) return false;
  if (typeof value === 'string') return /^data:(?:image|audio|video)\//i.test(value);
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false;
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.some(item => hasBinaryMedia(item, depth + 1, seen));
    if (typeof value.type === 'string' && /^(?:image|audio|video)$/i.test(value.type)) return true;
    if (typeof value.mimeType === 'string' && /^(?:image|audio|video)\//i.test(value.mimeType)) return true;
    if (typeof value.mime_type === 'string' && /^(?:image|audio|video)\//i.test(value.mime_type)) return true;
    return Object.values(value).some(item => hasBinaryMedia(item, depth + 1, seen));
  } finally {
    seen.delete(value);
  }
}

export function containsBinaryMedia(value) {
  return hasBinaryMedia(value, 0, new WeakSet());
}

export function compressToolResponse(response, options = {}) {
  const budget = Math.max(1200, Number(options.budget) || 9000);
  const rawText = responseToText(response);
  const originalChars = rawText.length;
  let text = cleanText(responseToText(dedupeStructuredText(response)));
  const bodyBudget = Math.max(500, budget - 700);
  const flattened = maybeFlattenJson(text, Math.min(96, Math.max(24, Math.floor(bodyBudget / 80))));
  const format = flattened ? 'json-paths' : 'text';
  if (flattened) text = flattened;
  const maxLine = Math.min(900, Math.max(240, bodyBudget - 140));
  const collapsed = collapseNearDuplicates(text.split('\n').map(line => clipLine(line, maxLine)));
  const lines = collapsed.lines;
  const candidates = chooseLines(lines, bodyBudget);
  const fitted = fitSelection(lines, candidates, bodyBudget);
  const body = fitted.text;
  const compressedChars = body.length;
  return {
    text: body,
    format,
    originalChars,
    compressedChars,
    originalLines: rawText.split(/\r?\n/).length,
    selectedLines: fitted.selected.length,
    duplicateGroups: collapsed.duplicateGroups,
    collapsedLines: collapsed.collapsedLines,
    estimatedTokensSaved: Math.max(0, estimateTokens(originalChars) - estimateTokens(compressedChars)),
  };
}

export function shouldCompress(response, config, mode = config.mode, budget) {
  if (!config.enabled || mode === 'passthrough') return false;
  if (containsBinaryMedia(response)) return false;
  const activeBudget = Number.isFinite(budget) ? budget : config.budgets?.[mode] ?? config.budgets?.balanced ?? 6000;
  return responseToText(response).length > Math.max(config.smallResponseChars, activeBudget + 1200);
}
