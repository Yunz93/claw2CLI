#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  discoverAvailableSessions
} from './src/codex-discovery.js';
import {
  getBackendCommandPrefix,
  getBackendDisplayName,
  normalizeBackendName
} from './src/cli-backends.js';
import {
  findLatestSessionByCwd,
  findSessionByCodexSessionId,
  getActiveSessionIdForChat,
  getRecentSessionByIndex,
  getRecentSessions,
  loadSessionStore,
  mergeAvailableSessions,
  recordSessionTurn,
  rememberActiveSession,
  saveSessionStore
} from './src/session-store.js';
import {
  buildAdapterPrompt,
  parseCodexCommand,
  renderSelectedSessionPreview,
  renderSessionList
} from './src/wechat-command.js';

function usage() {
  console.error('usage: wechat-trigger.js <chat_id> <text> [cwd] [session_id]');
  process.exit(2);
}

function execFileAsync(command, args, options) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (err, stdout, stderr) => {
      if (err) {
        reject({ err, stdout, stderr });
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PROJECT_ROOT = path.resolve(
  process.env.MAC_CLI_BRIDGE_PROJECT_ROOT || path.dirname(__dirname)
);

function getProjectName(cwd) {
  return cwd ? path.basename(cwd) : null;
}

function buildMeta({
  commandType,
  backend = 'codex',
  modeAction = 'keep',
  cwd = '',
  codexSessionId = null
}) {
  return {
    handledBy: 'claw2cli',
    backend,
    commandPrefix: getBackendCommandPrefix(backend),
    backendLabel: getBackendDisplayName(backend),
    commandType,
    modeAction,
    cwd: cwd || null,
    projectName: getProjectName(cwd),
    codexSessionId: codexSessionId || null
  };
}

function resolveProject(projectName) {
  const trimmed = (projectName || '').trim();
  if (!trimmed || /\s/.test(trimmed) || trimmed.includes('/') || trimmed.includes('\\') || trimmed === '.' || trimmed === '..') {
    return null;
  }

  const root = path.resolve(DEFAULT_PROJECT_ROOT);
  const resolvedCwd = path.resolve(root, trimmed);
  if (path.dirname(resolvedCwd) !== root) return null;

  try {
    if (!statSync(resolvedCwd).isDirectory()) return null;
    return { cwd: path.resolve(resolvedCwd), projectName: trimmed };
  } catch {
    return null;
  }
}

function printHandledResponse({
  sessionId,
  codexSessionId,
  finalText,
  meta
}) {
  console.log(JSON.stringify({
    ok: true,
    triggered: true,
    sessionId,
    codexSessionId,
    meta,
    result: {
      ok: true,
      done: true,
      finalText
    }
  }, null, 2));
}

async function main() {
  const [, , chatId, text, cwdArg, codexSessionIdArg] = process.argv;
  if (!chatId || !text) usage();

  const cwd = path.resolve(cwdArg || process.env.MAC_CLI_BRIDGE_CWD || DEFAULT_PROJECT_ROOT);
  const command = parseCodexCommand(text);
  if (!command.ok) {
    console.log(JSON.stringify({ ok: false, ignored: true, reason: command.reason }, null, 2));
    process.exit(0);
  }

  const backend = normalizeBackendName(command.backend, 'codex');
  const commandPrefix = getBackendCommandPrefix(backend);
  const backendLabel = getBackendDisplayName(backend);

  const sessionId = `wx:${chatId}`;
  const store = await loadSessionStore(__dirname);
  const discoveredSessions = discoverAvailableSessions();
  const availableStore = mergeAvailableSessions(store, discoveredSessions);
  const persistedActiveSessionId = getActiveSessionIdForChat(store, chatId, backend);
  const explicitSessionId = codexSessionIdArg || persistedActiveSessionId || '';

  if (command.type === 'enter') {
    const activeSession = findSessionByCodexSessionId(availableStore, explicitSessionId, backend);
    if (!activeSession) {
      const recentSessions = getRecentSessions(availableStore, 5, backend);
      const finalText = renderSessionList(recentSessions, null, {
        preface: `这是第一次在这个微信会话里用 bridge，先选一个 mac 上已有的 ${backendLabel} session。`,
        commandPrefix
      });
      printHandledResponse({
        sessionId,
        codexSessionId: null,
        finalText,
        meta: buildMeta({
          commandType: 'enter',
          backend,
          modeAction: 'keep',
          cwd,
          codexSessionId: null
        })
      });
      return;
    }

    const nextCwd = activeSession.cwd || cwd;
    const nextCodexSessionId = activeSession.codexSessionId;
    const updatedStore = rememberActiveSession(store, {
      chatId,
      backend,
      codexSessionId: nextCodexSessionId,
      cwd: nextCwd
    });
    await saveSessionStore(__dirname, updatedStore);

    printHandledResponse({
      sessionId,
      codexSessionId: nextCodexSessionId,
      finalText: renderSelectedSessionPreview(activeSession, {
        commandPrefix,
        intro: `${backendLabel} 已接入上次 bridge 使用的 session ${nextCodexSessionId}，接下来直接发消息就行，发 /exit 退出。`
      }),
      meta: buildMeta({
        commandType: 'enter',
        backend,
        modeAction: 'enable',
        cwd: nextCwd,
        codexSessionId: nextCodexSessionId
      })
    });
    return;
  }

  if (command.type === 'list') {
    const recentSessions = getRecentSessions(availableStore, command.limit || 5, backend);
    const finalText = renderSessionList(recentSessions, persistedActiveSessionId, {
      commandPrefix
    });
    printHandledResponse({
      sessionId,
      codexSessionId: persistedActiveSessionId,
      finalText,
      meta: buildMeta({
        commandType: 'list',
        backend,
        modeAction: 'keep',
        cwd,
        codexSessionId: persistedActiveSessionId
      })
    });
    return;
  }

  let targetSession = null;
  let targetCodexSessionId = explicitSessionId;
  let userPrompt = '';
  let prompt = '';
  let targetCwd = cwd;
  let metaCommandType = command.type;

  if (command.type === 'select') {
    targetSession = getRecentSessionByIndex(availableStore, command.index, backend);
    if (!targetSession) {
      printHandledResponse({
        sessionId,
        codexSessionId: persistedActiveSessionId,
        finalText: `没找到编号 ${command.index} 的 session。先发 \`${commandPrefix} list\` 看看。`,
        meta: buildMeta({
          commandType: 'select',
          backend,
          modeAction: 'keep',
          cwd,
          codexSessionId: persistedActiveSessionId
        })
      });
      return;
    }

    targetCodexSessionId = targetSession.codexSessionId;
    targetCwd = targetSession.cwd || cwd;
    const updatedStore = rememberActiveSession(store, {
      chatId,
      backend,
      codexSessionId: targetCodexSessionId,
      cwd: targetCwd
    });
    await saveSessionStore(__dirname, updatedStore);

    if (!command.prompt) {
      printHandledResponse({
        sessionId,
        codexSessionId: targetCodexSessionId,
        finalText: renderSelectedSessionPreview(targetSession, { commandPrefix }),
        meta: buildMeta({
          commandType: 'select',
          backend,
          modeAction: 'enable',
          cwd: targetCwd,
          codexSessionId: targetCodexSessionId
        })
      });
      return;
    }

    userPrompt = command.prompt;
    prompt = buildAdapterPrompt({
      userPrompt,
      selectedSession: targetSession,
      includeSelectedContext: true
    });
  } else {
    const directSession = findSessionByCodexSessionId(availableStore, command.prompt, backend);
    if (directSession) {
      targetSession = directSession;
      targetCodexSessionId = directSession.codexSessionId;
      targetCwd = directSession.cwd || cwd;
      const updatedStore = rememberActiveSession(store, {
        chatId,
        backend,
        codexSessionId: targetCodexSessionId,
        cwd: targetCwd
      });
      await saveSessionStore(__dirname, updatedStore);
      printHandledResponse({
        sessionId,
        codexSessionId: targetCodexSessionId,
        finalText: renderSelectedSessionPreview(directSession, { commandPrefix }),
        meta: buildMeta({
          commandType: 'session_id',
          backend,
          modeAction: 'enable',
          cwd: targetCwd,
          codexSessionId: targetCodexSessionId
        })
      });
      return;
    }

    const project = resolveProject(command.prompt);
    if (project) {
      metaCommandType = 'project';
      targetCwd = project.cwd;
      const latestProjectSession = findLatestSessionByCwd(availableStore, project.cwd, backend);
      targetCodexSessionId = latestProjectSession?.codexSessionId || null;
      if (targetCodexSessionId) {
        const updatedStore = rememberActiveSession(store, {
          chatId,
          backend,
          codexSessionId: targetCodexSessionId,
          cwd: project.cwd
        });
        await saveSessionStore(__dirname, updatedStore);
      }

      const finalText = latestProjectSession
        ? renderSelectedSessionPreview(latestProjectSession, {
            commandPrefix,
            intro: `已切到项目 ${project.projectName}，并接入 ${backendLabel} session ${latestProjectSession.codexSessionId}。接下来直接发消息就行，发 /exit 退出。`
          })
        : `已切到项目 ${project.projectName}。当前没有历史 session，下一条消息会新开 ${backendLabel} session，发 /exit 退出。`;
      printHandledResponse({
        sessionId,
        codexSessionId: targetCodexSessionId,
        finalText,
        meta: buildMeta({
          commandType: 'project',
          backend,
          modeAction: 'enable',
          cwd: project.cwd,
          codexSessionId: targetCodexSessionId
        })
      });
      return;
    }

    userPrompt = command.prompt;
    prompt = buildAdapterPrompt({ userPrompt });
  }

  try {
    const { stdout } = await execFileAsync(
      path.join(__dirname, 'openclaw-adapter.sh'),
      [sessionId, prompt, targetCwd, targetCodexSessionId, backend],
      {
        maxBuffer: 1024 * 1024 * 8,
        env: {
          ...process.env,
          MAC_CLI_BRIDGE_BACKEND: backend
        }
      }
    );

    let data;
    try {
      data = JSON.parse(stdout);
    } catch {
      console.log(JSON.stringify({ ok: false, error: 'invalid_adapter_output', stdout }, null, 2));
      process.exit(1);
    }

    const resolvedCodexSessionId = data?.codexSessionId || targetCodexSessionId || null;
    if (resolvedCodexSessionId) {
      const updatedStore = recordSessionTurn(store, {
        chatId,
        backend,
        codexSessionId: resolvedCodexSessionId,
        cwd: targetCwd,
        userPrompt,
        assistantReply: data?.finalText || ''
      });
      await saveSessionStore(__dirname, updatedStore);
    }

    console.log(JSON.stringify({
      ok: true,
      triggered: true,
      sessionId,
      codexSessionId: resolvedCodexSessionId,
      meta: buildMeta({
        commandType: metaCommandType,
        backend,
        modeAction: 'enable',
        cwd: targetCwd,
        codexSessionId: resolvedCodexSessionId
      }),
      prompt,
      result: data
    }, null, 2));
  } catch ({ err, stdout, stderr }) {
    console.log(JSON.stringify({ ok: false, error: String(err), stderr, stdout }, null, 2));
    process.exit(1);
  }
}

await main();
