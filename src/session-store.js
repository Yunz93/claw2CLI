import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeBackendName } from './cli-backends.js';

const STORE_VERSION = 1;
const MAX_SESSION_COUNT = 100;
const MAX_TURN_COUNT = 20;

function emptyStore() {
  return {
    version: STORE_VERSION,
    activeByChatId: {},
    sessions: []
  };
}

function clampPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return parsed;
}

function normalizeTurn(turn) {
  if (!turn || typeof turn !== 'object') return null;
  const role = turn.role === 'assistant' ? 'assistant' : turn.role === 'user' ? 'user' : null;
  const text = typeof turn.text === 'string' ? turn.text.trim() : '';
  if (!role || !text) return null;

  return {
    role,
    text,
    ts: clampPositiveInt(turn.ts, Date.now())
  };
}

function getChatKey(chatId, backend) {
  const normalizedBackend = normalizeBackendName(backend, 'codex');
  return `${normalizedBackend}:${chatId}`;
}

function splitChatKey(chatKey) {
  if (typeof chatKey !== 'string') {
    return { backend: 'codex', chatId: '' };
  }

  const separatorIndex = chatKey.indexOf(':');
  if (separatorIndex <= 0) {
    return { backend: 'codex', chatId: chatKey };
  }

  const backend = normalizeBackendName(chatKey.slice(0, separatorIndex), 'codex');
  const chatId = chatKey.slice(separatorIndex + 1);
  return { backend, chatId };
}

function normalizeSession(session) {
  if (!session || typeof session !== 'object') return null;
  const codexSessionId = typeof session.codexSessionId === 'string' ? session.codexSessionId.trim() : '';
  if (!codexSessionId) return null;
  const backend = normalizeBackendName(session.backend, 'codex');

  const turns = Array.isArray(session.turns)
    ? session.turns.map(normalizeTurn).filter(Boolean).slice(-MAX_TURN_COUNT)
    : [];

  return {
    codexSessionId,
    chatId: typeof session.chatId === 'string' ? session.chatId : '',
    backend,
    cwd: typeof session.cwd === 'string' ? session.cwd : '',
    createdAt: clampPositiveInt(session.createdAt, Date.now()),
    activatedAt: clampPositiveInt(session.activatedAt, Date.now()),
    turns
  };
}

function dedupeSessionsByCwd(sessions) {
  const kept = [];
  const seenKeys = new Set();

  for (const session of sessions) {
    const key = `${normalizeBackendName(session.backend, 'codex')}:${session.cwd || ''}`;
    if (session.cwd && seenKeys.has(key)) continue;
    if (session.cwd) {
      seenKeys.add(key);
    }
    kept.push(session);
  }

  return kept;
}

function normalizeStore(data) {
  if (!data || typeof data !== 'object') return emptyStore();

  const sessions = Array.isArray(data.sessions)
    ? data.sessions.map(normalizeSession).filter(Boolean)
    : [];

  sessions.sort((a, b) => b.activatedAt - a.activatedAt);
  const dedupedSessions = dedupeSessionsByCwd(sessions);

  const activeByChatId = {};
  if (data.activeByChatId && typeof data.activeByChatId === 'object') {
    for (const [chatId, codexSessionId] of Object.entries(data.activeByChatId)) {
      if (typeof chatId !== 'string' || typeof codexSessionId !== 'string') continue;
      const { backend, chatId: normalizedChatId } = splitChatKey(chatId);
      if (!dedupedSessions.some(session => (
        session.codexSessionId === codexSessionId && normalizeBackendName(session.backend, 'codex') === backend
      ))) continue;
      activeByChatId[getChatKey(normalizedChatId, backend)] = codexSessionId;
    }
  }

  return {
    version: STORE_VERSION,
    activeByChatId,
    sessions: dedupedSessions.slice(0, MAX_SESSION_COUNT)
  };
}

export function getStorePath(rootDir) {
  return path.join(rootDir, 'state', 'recent-sessions.json');
}

function mergeSessionRecords(...sessionLists) {
  const merged = new Map();

  for (const sessionList of sessionLists) {
    for (const rawSession of sessionList || []) {
      const session = normalizeSession(rawSession);
      if (!session) continue;
      const key = `${normalizeBackendName(session.backend, 'codex')}:${session.codexSessionId}`;
      const previous = merged.get(key);
      if (!previous) {
        merged.set(key, session);
        continue;
      }

      merged.set(key, {
        codexSessionId: session.codexSessionId,
        chatId: previous.chatId || session.chatId,
        backend: normalizeBackendName(previous.backend, 'codex'),
        cwd: previous.cwd || session.cwd,
        createdAt: Math.min(previous.createdAt, session.createdAt),
        activatedAt: Math.max(previous.activatedAt, session.activatedAt),
        turns: previous.turns.length >= session.turns.length ? previous.turns : session.turns
      });
    }
  }

  return [...merged.values()];
}

export async function loadSessionStore(rootDir) {
  const storePath = getStorePath(rootDir);
  try {
    const raw = await readFile(storePath, 'utf8');
    return normalizeStore(JSON.parse(raw));
  } catch (err) {
    if (err && err.code === 'ENOENT') return emptyStore();
    throw err;
  }
}

export async function saveSessionStore(rootDir, store) {
  const storePath = getStorePath(rootDir);
  await mkdir(path.dirname(storePath), { recursive: true });
  await writeFile(storePath, JSON.stringify(normalizeStore(store), null, 2) + '\n', 'utf8');
}

export function mergeAvailableSessions(store, discoveredSessions = []) {
  const normalized = normalizeStore(store);
  return normalizeStore({
    version: STORE_VERSION,
    activeByChatId: normalized.activeByChatId,
    sessions: mergeSessionRecords(normalized.sessions, discoveredSessions)
  });
}

export function getActiveSessionIdForChat(store, chatId, backend = 'codex') {
  const normalized = normalizeStore(store);
  const normalizedBackend = normalizeBackendName(backend, 'codex');
  return normalized.activeByChatId[getChatKey(chatId, normalizedBackend)] || (
    normalizedBackend === 'codex' ? normalized.activeByChatId[chatId] || null : null
  );
}

export function getRecentSessionByIndex(store, index, backend = null) {
  const recentSessions = getRecentSessions(store, MAX_SESSION_COUNT, backend);
  const normalizedIndex = clampPositiveInt(index, 0);
  if (!normalizedIndex) return null;
  return recentSessions[normalizedIndex - 1] || null;
}

export function findSessionByCodexSessionId(store, codexSessionId, backend = null) {
  if (!codexSessionId) return null;
  return normalizeStore(store).sessions.find(session => (
    session.codexSessionId === codexSessionId && (backend ? normalizeBackendName(session.backend, 'codex') === normalizeBackendName(backend, 'codex') : true)
  )) || null;
}

export function findLatestSessionByCwd(store, cwd, backend = null) {
  if (!cwd) return null;
  return normalizeStore(store).sessions.find(session => (
    session.cwd === cwd && (backend ? normalizeBackendName(session.backend, 'codex') === normalizeBackendName(backend, 'codex') : true)
  )) || null;
}

export function getLastMessages(session, count = 2) {
  if (!session) return [];
  return (Array.isArray(session.turns) ? session.turns : []).slice(-clampPositiveInt(count, 2));
}

export function getRecentSessions(store, limit = 5, backend = null) {
  const normalized = normalizeStore(store);
  const sessions = backend
    ? normalized.sessions.filter(session => normalizeBackendName(session.backend, 'codex') === normalizeBackendName(backend, 'codex'))
    : normalized.sessions;
  return sessions.slice(0, clampPositiveInt(limit, 5));
}

export function rememberActiveSession(store, { chatId, backend = 'codex', codexSessionId, cwd = '' }) {
  const normalized = normalizeStore(store);
  if (!chatId || !codexSessionId) return normalized;
  const normalizedBackend = normalizeBackendName(backend, 'codex');

  const now = Date.now();
  const existing = normalized.sessions.find(session => (
    session.codexSessionId === codexSessionId && normalizeBackendName(session.backend, 'codex') === normalizedBackend
  ));
  if (existing) {
    existing.chatId = chatId;
    existing.backend = normalizedBackend;
    existing.cwd = cwd || existing.cwd;
    existing.activatedAt = now;
  } else {
    normalized.sessions.unshift({
      codexSessionId,
      chatId,
      backend: normalizedBackend,
      cwd,
      createdAt: now,
      activatedAt: now,
      turns: []
    });
  }

  if (cwd) {
    normalized.sessions = normalized.sessions.filter(session => (
      session.codexSessionId === codexSessionId || normalizeBackendName(session.backend, 'codex') !== normalizedBackend || session.cwd !== cwd
    ));
  }

  normalized.activeByChatId[getChatKey(chatId, normalizedBackend)] = codexSessionId;
  normalized.sessions.sort((a, b) => b.activatedAt - a.activatedAt);
  normalized.sessions = dedupeSessionsByCwd(normalized.sessions).slice(0, MAX_SESSION_COUNT);
  return normalized;
}

export function recordSessionTurn(store, {
  chatId,
  backend = 'codex',
  codexSessionId,
  cwd = '',
  userPrompt = '',
  assistantReply = ''
}) {
  const remembered = rememberActiveSession(store, { chatId, backend, codexSessionId, cwd });
  if (!codexSessionId) return remembered;
  const normalizedBackend = normalizeBackendName(backend, 'codex');

  const session = remembered.sessions.find(item => (
    item.codexSessionId === codexSessionId && normalizeBackendName(item.backend, 'codex') === normalizedBackend
  ));
  if (!session) return remembered;

  const now = Date.now();
  session.activatedAt = now;

  const turns = [];
  const normalizedUser = normalizeTurn({ role: 'user', text: userPrompt, ts: now });
  const normalizedAssistant = normalizeTurn({ role: 'assistant', text: assistantReply, ts: now + 1 });
  if (normalizedUser) turns.push(normalizedUser);
  if (normalizedAssistant) turns.push(normalizedAssistant);

  if (turns.length) {
    session.turns = [...session.turns, ...turns].slice(-MAX_TURN_COUNT);
  }

  remembered.sessions.sort((a, b) => b.activatedAt - a.activatedAt);
  remembered.sessions = dedupeSessionsByCwd(remembered.sessions).slice(0, MAX_SESSION_COUNT);
  return remembered;
}

export function truncatePreview(text, maxLength = 60) {
  const normalized = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (!normalized) return '';
  if (normalized.length <= maxLength) return normalized;
  return normalized.slice(0, Math.max(1, maxLength - 1)).trimEnd() + '…';
}
