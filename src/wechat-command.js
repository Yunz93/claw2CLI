import path from 'node:path';

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

export function parseCodexCommand(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/codex')) {
    return { ok: false, reason: 'missing_prefix' };
  }

  const body = trimmed.replace(/^\/codex\s*/, '').trim();
  if (!body) {
    return { ok: true, type: 'enter' };
  }

  const listMatch = body.match(/^list(?:\s+(\d+))?$/i);
  if (listMatch) {
    return {
      ok: true,
      type: 'list',
      limit: listMatch[1] ? Number.parseInt(listMatch[1], 10) : 5
    };
  }

  const selectMatch = body.match(/^(\d+)(?:\s+([\s\S]*))?$/);
  if (selectMatch) {
    return {
      ok: true,
      type: 'select',
      index: Number.parseInt(selectMatch[1], 10),
      prompt: (selectMatch[2] || '').trim()
    };
  }

  return {
    ok: true,
    type: 'prompt',
    prompt: body
  };
}

export function renderSessionList(sessions, activeSessionId = null, options = {}) {
  const {
    preface = null,
    selectionHint = '发 `/codex 编号` 进入目标 session，或发 `/codex 编号 你的新消息` 直接续聊。'
  } = options;

  if (!sessions.length) {
    return '没有发现可用的 mac Codex session。';
  }

  const lines = [];
  if (preface) lines.push(preface);
  lines.push(`最近激活的 ${sessions.length} 个 session:`);
  for (const [index, session] of sessions.entries()) {
    const currentMark = session.codexSessionId === activeSessionId ? ' [当前]' : '';
    const lastMessage = getLastMessages(session, 1)[0] || null;
    const preview = lastMessage ? formatMessageLine(lastMessage) : '无历史消息';
    lines.push(`${index + 1}.${currentMark}`);
    lines.push(`session_id: ${session.codexSessionId}`);
    lines.push(`工作空间: ${formatWorkspaceLabel(session)}`);
    lines.push(`上次激活: ${formatTimestamp(session.activatedAt)}`);
    lines.push(`最后一条消息: ${preview}`);
    if (index < sessions.length - 1) lines.push('');
  }
  if (selectionHint) {
    lines.push('');
    lines.push(selectionHint);
  }
  return lines.join('\n');
}

export function renderSelectedSessionPreview(session) {
  const lastMessages = getLastMessages(session, 2);
  const lines = [
    `已切到 session ${truncatePreview(session.codexSessionId, 24)}。`
  ];

  if (!lastMessages.length) {
    lines.push('这个 session 还没有保存的最近消息。');
  } else {
    lines.push('最后两条消息:');
    for (const message of lastMessages) {
      lines.push(formatMessageLine(message));
    }
  }

  lines.push('现在直接发 `/codex 你的消息` 就会继续这个 session。');
  return lines.join('\n');
}

export function buildAdapterPrompt({ userPrompt }) {
  return (userPrompt || '').trim();
}
