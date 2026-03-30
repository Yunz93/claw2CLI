import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { normalizeBackendName } from './cli-backends.js';
import { buildFinalText } from './final-text.js';

const PORT = process.env.MAC_CLI_BRIDGE_PORT || 4317;
const sessions = new Map();
const ONESHOT_STALE_MS = Number(process.env.MAC_CLI_BRIDGE_ONESHOT_STALE_MS || 15000);
const DEFAULT_WAIT_TIMEOUT_MS = Number(process.env.MAC_CLI_BRIDGE_TIMEOUT_MS || 1800000);
const USER_LOCAL_BIN = `${process.env.HOME || '/Users/yunz'}/.local/bin`;

function isExecutableFile(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveExecutable(commandName, preferredPaths = []) {
  const candidates = [
    ...preferredPaths,
    ...String(process.env.PATH || '')
      .split(path.delimiter)
      .filter(Boolean)
      .map(dir => path.join(dir, commandName)),
  ];

  for (const candidate of candidates) {
    if (candidate && path.isAbsolute(candidate) && isExecutableFile(candidate)) {
      return candidate;
    }
  }

  return commandName;
}

function buildSpawnEnv(extraEnv = {}) {
  const currentPath = process.env.PATH || '';
  const pathParts = [
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    USER_LOCAL_BIN,
    currentPath,
  ].filter(Boolean);
  const dedupedPath = [...new Set(pathParts.join(':').split(':').filter(Boolean))].join(':');
  return {
    ...process.env,
    PATH: dedupedPath,
    ...extraEnv,
  };
}

function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data, null, 2));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
      try { resolve(raw ? JSON.parse(raw) : {}); } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function ensureBackendSessionId(backend, codexSessionId) {
  const rawBackend = typeof backend === 'string' ? backend.trim().toLowerCase() : '';
  if (rawBackend === 'codex-echo') return null;
  const normalizedBackend = normalizeBackendName(backend, 'codex');
  if (normalizedBackend === 'codex') return codexSessionId || null;
  if (codexSessionId) return codexSessionId;
  return randomUUID();
}

function buildBackendCommand({ backend, cwd, codexSessionId }) {
  const rawBackend = typeof backend === 'string' ? backend.trim().toLowerCase() : '';
  const normalizedBackend = rawBackend === 'codex-echo' ? 'codex-echo' : normalizeBackendName(backend, 'codex');

  if (rawBackend === 'codex-echo') {
    return {
      command: '/bin/cat',
      args: [],
      mode: 'oneshot',
      output: 'raw'
    };
  }

  if (normalizedBackend === 'codex') {
    if (codexSessionId) {
      return {
        command: '/opt/homebrew/bin/codex',
        args: [
          'exec',
          'resume',
          '--full-auto',
          '--skip-git-repo-check',
          '--json',
          codexSessionId,
          '-'
        ],
        mode: 'oneshot',
        output: 'jsonl'
      };
    }

    return {
      command: '/opt/homebrew/bin/codex',
      args: [
        'exec',
        '--skip-git-repo-check',
        '--sandbox', 'workspace-write',
        '--cd', cwd,
        '--json',
        '-'
      ],
      mode: 'oneshot',
      output: 'jsonl'
      };
  }

  if (normalizedBackend === 'claude') {
    const claudeBin = resolveExecutable('claude', [`${USER_LOCAL_BIN}/claude`]);
    const sessionArgs = codexSessionId ? ['--resume', codexSessionId] : [];
    return {
      command: claudeBin,
      args: [
        '--print',
        '--input-format',
        'text',
        '--output-format',
        'stream-json',
        '--verbose',
        '--dangerously-skip-permissions',
        ...sessionArgs
      ],
      mode: 'oneshot',
      output: 'jsonl',
    };
  }

  if (normalizedBackend === 'kimi') {
    const sessionId = ensureBackendSessionId(normalizedBackend, codexSessionId);
    const kimiBin = resolveExecutable('kimi', [`${USER_LOCAL_BIN}/kimi`]);
    return {
      command: '/bin/bash',
      args: [
        '-lc',
        `prompt="$(cat)"; exec ${JSON.stringify(kimiBin)} --quiet --session "$CLI_SESSION_ID" --prompt "$prompt"`
      ],
      mode: 'oneshot',
      output: 'raw',
      env: {
        CLI_SESSION_ID: sessionId
      }
    };
  }

  return {
    command: '/bin/bash',
    args: ['-lc', 'cat'],
    mode: 'interactive',
    output: 'raw'
  };
}

function attachOutput(state) {
  if (state.output === 'jsonl') {
    const rl = readline.createInterface({ input: state.child.stdout });
    rl.on('line', line => {
      if (!line.trim()) return;
      state.stdoutChunks.push(line + '\n');
      try {
        const obj = JSON.parse(line);
        state.buffer.push({ type: 'jsonl', data: obj, ts: Date.now() });
        if (state.backend === 'claude' && obj.type === 'system' && obj.subtype === 'init' && obj.session_id) {
          state.codexSessionId = obj.session_id;
        }
        if (obj.type === 'thread.started' && obj.thread_id) {
          state.codexSessionId = obj.thread_id;
        }
        if (obj.type === 'item.completed' && obj.item?.type === 'agent_message' && obj.item?.text) {
          state.finalMessages.push(obj.item.text);
        }
      } catch {
        state.buffer.push({ type: 'stdout', text: line + '\n', ts: Date.now() });
      }
      state.updatedAt = Date.now();
    });
  } else {
    state.child.stdout.on('data', chunk => {
      const text = String(chunk);
      state.buffer.push({ type: 'stdout', text, ts: Date.now() });
      state.stdoutChunks.push(text);
      state.updatedAt = Date.now();
    });
  }

  state.child.stderr.on('data', chunk => {
    const text = String(chunk);
    state.buffer.push({ type: 'stderr', text, ts: Date.now() });
    state.stderrChunks.push(text);
    state.updatedAt = Date.now();
  });

  state.child.on('exit', (code, signal) => {
    state.closed = true;
    state.exitCode = code;
    state.exitSignal = signal;
    state.updatedAt = Date.now();
    state.busy = false;
  });
}

function getFinalText(state) {
  return buildFinalText(state.finalMessages, state.stdoutChunks, state.stderrChunks);
}

function getClaudeFailureText(state) {
  for (const entry of state.buffer) {
    if (entry.type !== 'jsonl' || !entry.data || typeof entry.data !== 'object') continue;
    const data = entry.data;
    if (
      data.type === 'system' &&
      data.subtype === 'api_retry' &&
      data.error_status === 401 &&
      data.error === 'authentication_failed'
    ) {
      return 'Claude Code 认证失败（401 authentication_failed）';
    }
  }
  return null;
}

function cleanupState(state) {
  try { state.child.kill('SIGTERM'); } catch {}
  state.closed = true;
  state.busy = false;
  sessions.delete(state.id);
}

function isStaleOneshot(state) {
  return state.mode === 'oneshot' && (Date.now() - state.updatedAt > ONESHOT_STALE_MS);
}

function openSession({ sessionId, backend = 'codex-echo', cwd = process.cwd(), codexSessionId = null }) {
  const rawBackend = typeof backend === 'string' ? backend.trim().toLowerCase() : '';
  const normalizedBackend = rawBackend === 'codex-echo' ? 'codex-echo' : normalizeBackendName(backend, 'codex');
  const resolvedSessionId = normalizedBackend === 'claude'
    ? (codexSessionId || null)
    : ensureBackendSessionId(normalizedBackend, codexSessionId);
  if (sessions.has(sessionId)) {
    const existing = sessions.get(sessionId);
    if (
      existing.mode === 'oneshot' ||
      existing.closed ||
      !processAlive(existing.pid) ||
      isStaleOneshot(existing)
    ) {
      cleanupState(existing);
    } else {
      return existing;
    }
  }

  const spec = buildBackendCommand({ backend: normalizedBackend, cwd, codexSessionId: resolvedSessionId });
  const child = spawn(spec.command, spec.args, {
    cwd,
    env: buildSpawnEnv(spec.env || {}),
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const state = {
    id: sessionId,
    backend: rawBackend === 'codex-echo' ? 'codex-echo' : normalizedBackend,
    cwd,
    codexSessionId: resolvedSessionId,
    mode: spec.mode,
    output: spec.output,
    env: spec.env || {},
    pid: child.pid,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    child,
    buffer: [],
    finalMessages: [],
    stdoutChunks: [],
    stderrChunks: [],
    closed: false,
    busy: false
  };
  attachOutput(state);
  sessions.set(sessionId, state);
  return state;
}

function getOrReopenSession(sessionId) {
  const state = sessions.get(sessionId);
  if (!state) return null;

  if (
    state.closed ||
    !processAlive(state.pid) ||
    isStaleOneshot(state)
  ) {
    const cfg = { sessionId: state.id, backend: state.backend, cwd: state.cwd, codexSessionId: state.codexSessionId };
    cleanupState(state);
    return openSession(cfg);
  }

  return state;
}

async function waitForCompletion(state, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS, pollMs = 400) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (state.backend === 'claude') {
      if (state.finalMessages.length > 0) {
        const finalText = getFinalText(state);
        cleanupState(state);
        return {
          done: true,
          codexSessionId: state.codexSessionId ?? null,
          exitCode: state.exitCode ?? null,
          exitSignal: state.exitSignal ?? null,
          finalText
        };
      }
      const failureText = getClaudeFailureText(state);
      if (failureText) {
        cleanupState(state);
        return {
          done: true,
          codexSessionId: state.codexSessionId ?? null,
          exitCode: state.exitCode ?? null,
          exitSignal: state.exitSignal ?? null,
          finalText: failureText
        };
      }
    }
    if (state.closed) {
      return {
        done: true,
        codexSessionId: state.codexSessionId ?? null,
        exitCode: state.exitCode ?? null,
        exitSignal: state.exitSignal ?? null,
        finalText: getFinalText(state)
      };
    }
    await new Promise(r => setTimeout(r, pollMs));
  }
  cleanupState(state);
  return {
    done: false,
    codexSessionId: state.codexSessionId ?? null,
    timeout: true,
    finalText: getFinalText(state)
  };
}

function getWaitTimeoutMs(state, requestedTimeoutMs = DEFAULT_WAIT_TIMEOUT_MS) {
  return requestedTimeoutMs;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/healthz') {
      return sendJson(res, 200, { ok: true, port: PORT, sessions: sessions.size });
    }

    if (req.method === 'GET' && req.url === '/sessions') {
      const data = [...sessions.values()].map(s => ({
        id: s.id,
        backend: s.backend,
        cwd: s.cwd,
        codexSessionId: s.codexSessionId,
        env: s.env,
        mode: s.mode,
        pid: s.pid,
        closed: s.closed,
        busy: s.busy,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        stale: isStaleOneshot(s)
      }));
      return sendJson(res, 200, { ok: true, sessions: data });
    }

    if (req.method === 'POST' && req.url === '/sessions/open') {
      const body = await readBody(req);
      const sessionId = body.sessionId || randomUUID();
      const state = openSession({ ...body, sessionId });
      return sendJson(res, 200, {
        ok: true,
        sessionId,
        pid: state.pid,
        backend: state.backend,
        cwd: state.cwd,
        codexSessionId: state.codexSessionId,
        env: state.env,
        mode: state.mode,
        output: state.output
      });
    }

    if (req.method === 'POST' && req.url === '/sessions/send') {
      const body = await readBody(req);
      let state = getOrReopenSession(body.sessionId);
      if (!state) return sendJson(res, 404, { ok: false, error: 'session_not_found' });
      if (state.mode === 'oneshot' && state.busy && processAlive(state.pid)) {
        return sendJson(res, 409, { ok: false, error: 'session_busy' });
      }
      state.busy = true;
      state.updatedAt = Date.now();
      state.finalMessages = [];
      state.stdoutChunks = [];
      state.stderrChunks = [];
      state.child.stdin.write((body.message || '') + '\n');
      if (state.mode === 'oneshot') {
        state.child.stdin.end();
      }
      return sendJson(res, 200, { ok: true, mode: state.mode });
    }

    if (req.method === 'GET' && req.url.startsWith('/sessions/events?')) {
      const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
      const sessionId = url.searchParams.get('sessionId');
      const state = sessions.get(sessionId);
      if (!state) return sendJson(res, 404, { ok: false, error: 'session_not_found' });
      const events = state.buffer.splice(0, state.buffer.length);
      return sendJson(res, 200, {
        ok: true,
        sessionId,
        backend: state.backend,
        closed: state.closed,
        busy: state.busy,
        stale: isStaleOneshot(state),
        events,
        finalText: getFinalText(state),
        exitCode: state.exitCode ?? null,
        exitSignal: state.exitSignal ?? null
      });
    }

    if (req.method === 'POST' && req.url === '/sessions/wait') {
      const body = await readBody(req);
      const state = sessions.get(body.sessionId);
      if (!state) return sendJson(res, 404, { ok: false, error: 'session_not_found' });
      const result = await waitForCompletion(state, getWaitTimeoutMs(state, body.timeoutMs || DEFAULT_WAIT_TIMEOUT_MS));
      return sendJson(res, 200, { ok: true, sessionId: body.sessionId, ...result });
    }

    if (req.method === 'POST' && req.url === '/sessions/close') {
      const body = await readBody(req);
      const state = sessions.get(body.sessionId);
      if (!state) return sendJson(res, 404, { ok: false, error: 'session_not_found' });
      cleanupState(state);
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 404, { ok: false, error: 'not_found' });
  } catch (err) {
    return sendJson(res, 500, { ok: false, error: String(err) });
  }
});

server.on('error', err => {
  console.error(err);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`claw2cli listening on http://127.0.0.1:${PORT}`);
});
