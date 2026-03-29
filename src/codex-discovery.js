import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { normalizeBackendName } from './cli-backends.js';

const CODEX_HOME = path.join(process.env.HOME || '', '.codex');
const CLAUDE_HOME = path.join(process.env.HOME || '', '.claude');
const KIMI_HOME = path.join(process.env.HOME || '', '.kimi');
const CODEX_SESSIONS_ROOT = path.join(CODEX_HOME, 'sessions');
const CODEX_ARCHIVED_SESSIONS_ROOT = path.join(CODEX_HOME, 'archived_sessions');
const CODEX_SESSION_INDEX_PATH = path.join(CODEX_HOME, 'session_index.jsonl');
const CLAUDE_PROJECTS_ROOT = path.join(CLAUDE_HOME, 'projects');
const KIMI_SESSIONS_ROOT = path.join(KIMI_HOME, 'sessions');

function walkSessionFiles(root) {
  try {
    const entries = readdirSync(root, { withFileTypes: true });
    return entries.flatMap((entry) => {
      const fullPath = path.join(root, entry.name);
      if (entry.isDirectory()) return walkSessionFiles(fullPath);
      return entry.isFile() && entry.name.endsWith('.jsonl') ? [fullPath] : [];
    });
  } catch {
    return [];
  }
}

function toTimestamp(value, fallback = 0) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function getFileTimestamp(filePath, fallback = 0) {
  try {
    return statSync(filePath).mtimeMs || fallback;
  } catch {
    return fallback;
  }
}

function extractTextFromContent(content) {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    const texts = content.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      if (typeof item.text === 'string') return [item.text];
      if (typeof item.content === 'string') return [item.content];
      return [];
    });
    return texts.join('\n').trim();
  }

  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') return content.text.trim();
    if (typeof content.content === 'string') return content.content.trim();
  }

  return '';
}

function extractMessageText(content) {
  return extractTextFromContent(content);
}

function extractCwdFromCommand(command) {
  if (typeof command !== 'string') return '';
  const match = command.match(/\bcd\s+([^;&|]+)/);
  if (!match) return '';
  return match[1].trim().replace(/^["']|["']$/g, '');
}

function extractCwdFromToolCalls(toolCalls) {
  if (!Array.isArray(toolCalls)) return '';
  for (const toolCall of toolCalls) {
    if (!toolCall || typeof toolCall !== 'object') continue;
    const payload = toolCall.function?.arguments || toolCall.input || toolCall.arguments || '';
    if (typeof payload !== 'string' || !payload.trim()) continue;

    let parsed = null;
    try {
      parsed = JSON.parse(payload);
    } catch {
      parsed = null;
    }

    if (parsed && typeof parsed === 'object') {
      if (typeof parsed.cwd === 'string' && parsed.cwd.trim()) return parsed.cwd.trim();
      if (typeof parsed.command === 'string') {
        const cwd = extractCwdFromCommand(parsed.command);
        if (cwd) return cwd;
      }
      if (typeof parsed.workDir === 'string' && parsed.workDir.trim()) return parsed.workDir.trim();
      if (typeof parsed.work_dir === 'string' && parsed.work_dir.trim()) return parsed.work_dir.trim();
    }
  }

  return '';
}

function parseClaudeTurns(lines) {
  const turns = [];
  let sessionId = '';
  let cwd = '';
  let sessionName = '';
  let createdAt = 0;
  let activatedAt = 0;

  for (const line of lines) {
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }

    if (typeof item?.sessionId === 'string' && item.sessionId.trim()) {
      sessionId = item.sessionId.trim();
    }
    if (typeof item?.cwd === 'string' && item.cwd.trim()) {
      cwd = item.cwd.trim();
    }
    if (typeof item?.slug === 'string' && item.slug.trim()) {
      sessionName = item.slug.trim();
    }

    const timestamp = toTimestamp(item?.timestamp, 0);
    if (!createdAt && timestamp) createdAt = timestamp;
    if (timestamp) activatedAt = Math.max(activatedAt, timestamp);

    const role = item?.message?.role || item?.role || null;
    if (role !== 'user' && role !== 'assistant') continue;

    const text = extractMessageText(item?.message?.content || item?.content || []);
    if (!text) continue;
    turns.push({
      role,
      text,
      ts: timestamp || Date.now()
    });
  }

  return {
    sessionId,
    cwd,
    sessionName,
    createdAt,
    activatedAt,
    turns
  };
}

function parseKimiTurns(lines) {
  const turns = [];
  let sessionId = '';
  let cwd = '';
  let sessionName = '';
  let createdAt = 0;
  let activatedAt = 0;

  for (const line of lines) {
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      continue;
    }

    const timestamp = toTimestamp(item?.timestamp, 0);
    if (!createdAt && timestamp) createdAt = timestamp;
    if (timestamp) activatedAt = Math.max(activatedAt, timestamp);

    if (typeof item?.sessionId === 'string' && item.sessionId.trim()) {
      sessionId = item.sessionId.trim();
    }
    if (typeof item?.cwd === 'string' && item.cwd.trim()) {
      cwd = item.cwd.trim();
    }
    if (typeof item?.plan_slug === 'string' && item.plan_slug.trim()) {
      sessionName = item.plan_slug.trim();
    }

    if (!cwd) {
      cwd = extractCwdFromToolCalls(item?.tool_calls || item?.message?.tool_calls || []);
    }

    const role = item?.role || item?.message?.role || null;
    if (role !== 'user' && role !== 'assistant') continue;

    const text = extractMessageText(item?.content || item?.message?.content || []);
    if (!text) continue;
    turns.push({
      role,
      text,
      ts: timestamp || Date.now()
    });
  }

  return {
    sessionId,
    cwd,
    sessionName,
    createdAt,
    activatedAt,
    turns
  };
}

function loadSessionIndex() {
  const result = new Map();
  try {
    const raw = readFileSync(CODEX_SESSION_INDEX_PATH, 'utf8');
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const item = JSON.parse(trimmed);
        if (!item?.id) continue;
        result.set(item.id, {
          sessionName: typeof item.thread_name === 'string' ? item.thread_name : undefined,
          updatedAt: typeof item.updated_at === 'string' ? item.updated_at : undefined
        });
      } catch {
        // ignore broken jsonl lines
      }
    }
  } catch {
    // ignore missing index
  }
  return result;
}

function parseSessionFile(filePath, index) {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    if (!lines.length) return null;

    let sessionId = '';
    let cwd = '';
    let createdAt = 0;
    const turns = [];

    for (const line of lines) {
      let item;
      try {
        item = JSON.parse(line);
      } catch {
        continue;
      }

      if (item?.type === 'session_meta' && item?.payload?.id) {
        sessionId = item.payload.id;
        cwd = typeof item.payload.cwd === 'string' ? item.payload.cwd : '';
        createdAt = toTimestamp(item.payload.timestamp, createdAt);
        continue;
      }

      if (item?.type === 'response_item' && item?.payload?.type === 'message') {
        const role = item.payload.role;
        if (role !== 'user' && role !== 'assistant') continue;
        const text = extractMessageText(item.payload.content);
        if (!text) continue;
        turns.push({
          role,
          text,
          ts: toTimestamp(item.timestamp, Date.now())
        });
      }
    }

    if (!sessionId) return null;
    const indexed = index.get(sessionId);
    const activatedAt = toTimestamp(indexed?.updatedAt, turns.at(-1)?.ts || createdAt || 0);

    return {
      codexSessionId: sessionId,
      chatId: '',
      cwd,
      createdAt: createdAt || activatedAt || Date.now(),
      activatedAt: activatedAt || createdAt || Date.now(),
      turns: turns.slice(-20),
      sessionName: indexed?.sessionName
    };
  } catch {
    return null;
  }
}

function parseClaudeSessionFile(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    if (!lines.length) return null;

    const parsed = parseClaudeTurns(lines);
    const sessionId = parsed.sessionId || path.basename(filePath, '.jsonl');
    if (!sessionId) return null;

    const createdAt = parsed.createdAt || getFileTimestamp(filePath);
    const activatedAt = parsed.activatedAt || createdAt;

    return {
      codexSessionId: sessionId,
      chatId: '',
      backend: 'claude',
      cwd: parsed.cwd,
      createdAt,
      activatedAt,
      turns: parsed.turns.slice(-20),
      sessionName: parsed.sessionName || undefined
    };
  } catch {
    return null;
  }
}

function parseKimiSessionFile(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf8');
    const lines = raw.split('\n').filter(Boolean);
    if (!lines.length) return null;

    const parsed = parseKimiTurns(lines);
    const sessionId = parsed.sessionId || path.basename(path.dirname(filePath));
    if (!sessionId) return null;

    const createdAt = parsed.createdAt || getFileTimestamp(filePath);
    const activatedAt = parsed.activatedAt || createdAt;

    return {
      codexSessionId: sessionId,
      chatId: '',
      backend: 'kimi',
      cwd: parsed.cwd,
      createdAt,
      activatedAt,
      turns: parsed.turns.slice(-20),
      sessionName: parsed.sessionName || undefined
    };
  } catch {
    return null;
  }
}

export function discoverSessionsForBackend(backend) {
  const canonicalBackend = normalizeBackendName(backend, 'codex');

  if (canonicalBackend === 'claude') {
    const files = walkSessionFiles(CLAUDE_PROJECTS_ROOT);
    const sessions = new Map();
    for (const filePath of files) {
      const parsed = parseClaudeSessionFile(filePath);
      if (!parsed) continue;
      const previous = sessions.get(parsed.codexSessionId);
      if (!previous || parsed.activatedAt >= previous.activatedAt) {
        sessions.set(parsed.codexSessionId, parsed);
      }
    }
    return [...sessions.values()].sort((a, b) => b.activatedAt - a.activatedAt);
  }

  if (canonicalBackend === 'kimi') {
    const files = walkSessionFiles(KIMI_SESSIONS_ROOT).filter((filePath) => filePath.endsWith('context.jsonl'));
    const sessions = new Map();
    for (const filePath of files) {
      const parsed = parseKimiSessionFile(filePath);
      if (!parsed) continue;
      const previous = sessions.get(parsed.codexSessionId);
      if (!previous || parsed.activatedAt >= previous.activatedAt) {
        sessions.set(parsed.codexSessionId, parsed);
      }
    }
    return [...sessions.values()].sort((a, b) => b.activatedAt - a.activatedAt);
  }

  const index = loadSessionIndex();
  const files = [
    ...walkSessionFiles(CODEX_SESSIONS_ROOT),
    ...walkSessionFiles(CODEX_ARCHIVED_SESSIONS_ROOT)
  ];

  const sessions = new Map();
  for (const filePath of files) {
    const parsed = parseSessionFile(filePath, index);
    if (!parsed) continue;
    const previous = sessions.get(parsed.codexSessionId);
    if (!previous || parsed.activatedAt >= previous.activatedAt) {
      sessions.set(parsed.codexSessionId, parsed);
    }
  }

  return [...sessions.values()].sort((a, b) => b.activatedAt - a.activatedAt);
}

export function discoverCodexSessions() {
  return discoverSessionsForBackend('codex');
}

export function discoverClaudeSessions() {
  return discoverSessionsForBackend('claude');
}

export function discoverKimiSessions() {
  return discoverSessionsForBackend('kimi');
}

export function discoverAvailableSessions() {
  return [
    ...discoverCodexSessions(),
    ...discoverClaudeSessions(),
    ...discoverKimiSessions()
  ].sort((a, b) => b.activatedAt - a.activatedAt);
}
