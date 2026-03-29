import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const CODEX_HOME = path.join(process.env.HOME || '', '.codex');
const CODEX_SESSIONS_ROOT = path.join(CODEX_HOME, 'sessions');
const CODEX_ARCHIVED_SESSIONS_ROOT = path.join(CODEX_HOME, 'archived_sessions');
const CODEX_SESSION_INDEX_PATH = path.join(CODEX_HOME, 'session_index.jsonl');

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

function extractMessageText(content) {
  if (!Array.isArray(content)) return '';
  const texts = content.flatMap((item) => {
    if (!item || typeof item !== 'object') return [];
    return typeof item.text === 'string' ? [item.text] : [];
  });
  return texts.join('\n').trim();
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

export function discoverCodexSessions() {
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
