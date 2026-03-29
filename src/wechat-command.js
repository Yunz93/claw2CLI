import path from 'node:path';

import {
  getBackendCommandPrefix,
  getBackendDisplayName,
  normalizeBackendName
} from './cli-backends.js';
import { getLastMessages, truncatePreview } from './session-store.js';

function formatTimestamp(timestamp) {
  if (!timestamp) return 'unknown';
  return new Date(timestamp).toLocaleString('zh-CN', {
    hour12: false,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatMessageLine(message) {
  const roleLabel = message.role === 'assistant' ? '助手' : '用户';
  return `${roleLabel}: ${truncatePreview(message.text, 72)}`;
}

function formatWorkspaceLabel(session) {
  if (!session?.cwd) return '-';
  const base = path.basename(session.cwd) || session.cwd;
  return `${base} (${session.cwd})`;
}

function buildSelectionHint(commandPrefix) {
  return `发 \`${commandPrefix} 编号\` 进入目标 session，或发 \`${commandPrefix} 编号 你的新消息\` 直接续聊。`;
}

export function parseCodexCommand(text) {
  const trimmed = text.trim();
  const commandMatch = trimmed.match(/^\/(codex|claude|cc|kimi)(?:\s+([\s\S]*))?$/i);
  if (!commandMatch) {
    return { ok: false, reason: 'missing_prefix' };
  }

  const backend = normalizeBackendName(commandMatch[1], 'codex');
  const body = (commandMatch[2] || '').trim();
  if (!body) {
    return { ok: true, type: 'enter', backend };
  }

  const listMatch = body.match(/^list(?:\s+(\d+))?$/i);
  if (listMatch) {
    return {
      ok: true,
      type: 'list',
      backend,
      limit: listMatch[1] ? Number.parseInt(listMatch[1], 10) : 5
    };
  }

  const selectMatch = body.match(/^(\d+)(?:\s+([\s\S]*))?$/);
  if (selectMatch) {
    return {
      ok: true,
      type: 'select',
      backend,
      index: Number.parseInt(selectMatch[1], 10),
      prompt: (selectMatch[2] || '').trim()
    };
  }

  return {
    ok: true,
    type: 'prompt',
    backend,
    prompt: body
  };
}

export function renderSessionList(sessions, activeSessionId = null, options = {}) {
  const {
    preface = null,
    commandPrefix = '/codex',
    selectionHint = null
  } = options;

  if (!sessions.length) {
    return '没有发现可用的 mac CLI session。';
  }

  const lines = [];
  if (preface) lines.push(preface);
  lines.push(`最近激活的 ${sessions.length} 个 session:`);
  for (const [index, session] of sessions.entries()) {
    const currentMark = session.codexSessionId === activeSessionId ? ' [当前]' : '';
    const lastMessage = getLastMessages(session, 1)[0] || null;
    const preview = lastMessage ? formatMessageLine(lastMessage) : '无历史消息';
    const backendLabel = getBackendDisplayName(session.backend);
    lines.push(`${index + 1}.${currentMark}`);
    lines.push(`后端: ${backendLabel}`);
    lines.push(`session_id: ${session.codexSessionId}`);
    lines.push(`工作空间: ${formatWorkspaceLabel(session)}`);
    lines.push(`上次激活: ${formatTimestamp(session.activatedAt)}`);
    lines.push(`最后一条消息: ${preview}`);
    if (index < sessions.length - 1) lines.push('');
  }
  if (selectionHint) {
    lines.push('');
    lines.push(selectionHint);
  } else if (commandPrefix) {
    lines.push('');
    lines.push(buildSelectionHint(commandPrefix));
  }
  return lines.join('\n');
}

export function renderSelectedSessionPreview(session, options = {}) {
  const {
    commandPrefix = getBackendCommandPrefix(session?.backend),
    intro = null
  } = options;
  const lastMessages = getLastMessages(session, 2);
  const backendLabel = getBackendDisplayName(session?.backend);
  const lines = [];

  if (intro) lines.push(intro);
  lines.push(`已切到 ${backendLabel} session ${truncatePreview(session.codexSessionId, 24)}。`);
  lines.push(`工作空间: ${formatWorkspaceLabel(session)}`);

  if (!lastMessages.length) {
    lines.push('这个 session 还没有保存的最近消息。');
  } else {
    lines.push('最后两条消息:');
    for (const message of lastMessages) {
      lines.push(formatMessageLine(message));
    }
  }

  lines.push(`现在直接发 \`${commandPrefix} 你的消息\` 就会继续这个 session。`);
  return lines.join('\n');
}

export function buildAdapterPrompt({ userPrompt }) {
  return (userPrompt || '').trim();
}
