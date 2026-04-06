import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clearActiveSession,
  getActiveSessionIdForChat,
  getLastMessages,
  getRecentSessionByIndex,
  getRecentSessions,
  mergeAvailableSessions,
  recordSessionTurn,
  rememberActiveSession
} from '../src/session-store.js';
import {
  buildAdapterPrompt,
  parseCodexCommand,
  renderSelectedSessionPreview,
  renderSessionList
} from '../src/wechat-command.js';

test('parseCodexCommand handles list, select, and plain prompt', () => {
  assert.deepEqual(parseCodexCommand('/codex'), {
    ok: true,
    type: 'enter',
    backend: 'codex'
  });

  assert.deepEqual(parseCodexCommand('/codex list'), {
    ok: true,
    type: 'list',
    backend: 'codex',
    limit: 5
  });

  assert.deepEqual(parseCodexCommand('/codex list 9'), {
    ok: true,
    type: 'list',
    backend: 'codex',
    limit: 9
  });

  assert.deepEqual(parseCodexCommand('/codex new /tmp/workspace'), {
    ok: true,
    type: 'new',
    backend: 'codex',
    workspacePath: '/tmp/workspace'
  });

  assert.deepEqual(parseCodexCommand('/codex new'), {
    ok: true,
    type: 'new',
    backend: 'codex',
    workspacePath: ''
  });

  assert.deepEqual(parseCodexCommand('/codex new feature idea'), {
    ok: true,
    type: 'prompt',
    backend: 'codex',
    prompt: 'new feature idea'
  });

  assert.deepEqual(parseCodexCommand('/codex new "feature idea"'), {
    ok: true,
    type: 'prompt',
    backend: 'codex',
    prompt: 'new "feature idea"'
  });

  assert.deepEqual(parseCodexCommand('/codex 2 继续'), {
    ok: true,
    type: 'select',
    backend: 'codex',
    index: 2,
    prompt: '继续'
  });

  assert.deepEqual(parseCodexCommand('/codex 3'), {
    ok: true,
    type: 'select',
    backend: 'codex',
    index: 3,
    prompt: ''
  });

  assert.deepEqual(parseCodexCommand('/codex 修 bug'), {
    ok: true,
    type: 'prompt',
    backend: 'codex',
    prompt: '修 bug'
  });

  assert.deepEqual(parseCodexCommand('/claude list 2'), {
    ok: true,
    type: 'list',
    backend: 'claude',
    limit: 2
  });

  assert.deepEqual(parseCodexCommand('/cc list 3'), {
    ok: true,
    type: 'list',
    backend: 'claude',
    limit: 3
  });

  assert.deepEqual(parseCodexCommand('/claude new ../repo'), {
    ok: true,
    type: 'new',
    backend: 'claude',
    workspacePath: '../repo'
  });

  assert.deepEqual(parseCodexCommand('/kimi 7'), {
    ok: true,
    type: 'select',
    backend: 'kimi',
    index: 7,
    prompt: ''
  });
});

test('session store tracks active session and recent messages', () => {
  let store = rememberActiveSession({
    version: 1,
    activeByChatId: {},
    sessions: []
  }, {
    chatId: 'chat-a',
    backend: 'codex',
    codexSessionId: 'thread-1',
    cwd: '/tmp/a'
  });

  store = recordSessionTurn(store, {
    chatId: 'chat-a',
    backend: 'codex',
    codexSessionId: 'thread-1',
    cwd: '/tmp/a',
    userPrompt: '第一问',
    assistantReply: '第一答'
  });

  store = recordSessionTurn(store, {
    chatId: 'chat-b',
    backend: 'codex',
    codexSessionId: 'thread-2',
    cwd: '/tmp/b',
    userPrompt: '第二问',
    assistantReply: '第二答'
  });

  assert.equal(getActiveSessionIdForChat(store, 'chat-a'), 'thread-1');
  assert.equal(getActiveSessionIdForChat(store, 'chat-b'), 'thread-2');
  assert.equal(getRecentSessions(store, 5).length, 2);
  assert.equal(getRecentSessionByIndex(store, 1).codexSessionId, 'thread-2');
  assert.deepEqual(
    getLastMessages(getRecentSessionByIndex(store, 2), 2).map(message => message.text),
    ['第一问', '第一答']
  );
});

test('session store can clear active session binding for a chat/backend', () => {
  let store = rememberActiveSession({
    version: 1,
    activeByChatId: {},
    sessions: []
  }, {
    chatId: 'chat-a',
    backend: 'codex',
    codexSessionId: 'thread-1',
    cwd: '/tmp/a'
  });

  store = rememberActiveSession(store, {
    chatId: 'chat-a',
    backend: 'claude',
    codexSessionId: 'thread-2',
    cwd: '/tmp/b'
  });

  store = clearActiveSession(store, {
    chatId: 'chat-a',
    backend: 'codex'
  });

  assert.equal(getActiveSessionIdForChat(store, 'chat-a', 'codex'), null);
  assert.equal(getActiveSessionIdForChat(store, 'chat-a', 'claude'), 'thread-2');
});

test('session store keeps backend-specific sessions separate per cwd', () => {
  let store = {
    version: 1,
    activeByChatId: {},
    sessions: []
  };

  store = recordSessionTurn(store, {
    chatId: 'chat-a',
    backend: 'codex',
    codexSessionId: 'thread-1',
    cwd: '/same/project',
    userPrompt: '旧会话',
    assistantReply: '旧回答'
  });

  store = recordSessionTurn(store, {
    chatId: 'chat-a',
    backend: 'claude',
    codexSessionId: 'thread-2',
    cwd: '/same/project',
    userPrompt: 'Claude 会话',
    assistantReply: 'Claude 回答'
  });

  store = recordSessionTurn(store, {
    chatId: 'chat-a',
    backend: 'codex',
    codexSessionId: 'thread-3',
    cwd: '/same/project',
    userPrompt: '新 Codex 会话',
    assistantReply: '新 Codex 回答'
  });

  store = recordSessionTurn(store, {
    chatId: 'chat-a',
    backend: 'kimi',
    codexSessionId: 'thread-4',
    cwd: '/other/project',
    userPrompt: 'Kimi 会话',
    assistantReply: 'Kimi 回答'
  });

  const recentSessions = getRecentSessions(store, 5);
  assert.equal(recentSessions.length, 3);
  assert.equal(recentSessions.some(session => session.codexSessionId === 'thread-1'), false);
  assert.equal(recentSessions.some(session => session.codexSessionId === 'thread-2' && session.backend === 'claude'), true);
  assert.equal(recentSessions.some(session => session.codexSessionId === 'thread-3' && session.backend === 'codex'), true);
  assert.equal(recentSessions.some(session => session.codexSessionId === 'thread-4' && session.backend === 'kimi'), true);
});

test('mergeAvailableSessions falls back to discovered codex sessions', () => {
  const merged = mergeAvailableSessions({
    version: 1,
    activeByChatId: {},
    sessions: []
  }, [
    {
      codexSessionId: 'thread-a',
      chatId: '',
      backend: 'codex',
      cwd: '/same/project',
      createdAt: 1,
      activatedAt: 1000,
      turns: [{ role: 'user', text: 'old', ts: 1 }]
    },
    {
      codexSessionId: 'thread-b',
      chatId: '',
      backend: 'codex',
      cwd: '/same/project',
      createdAt: 2,
      activatedAt: 2000,
      turns: [{ role: 'user', text: 'new', ts: 2 }]
    },
    {
      codexSessionId: 'thread-c',
      chatId: '',
      backend: 'claude',
      cwd: '/other/project',
      createdAt: 3,
      activatedAt: 3000,
      turns: [{ role: 'assistant', text: 'reply', ts: 3 }]
    }
  ]);

  const recentSessions = getRecentSessions(merged, 5);
  assert.equal(recentSessions.length, 2);
  assert.equal(recentSessions[0].codexSessionId, 'thread-c');
  assert.equal(recentSessions[0].backend, 'claude');
  assert.equal(recentSessions[1].codexSessionId, 'thread-b');
  assert.equal(recentSessions[1].backend, 'codex');
});

test('render helpers expose numbered sessions and selected preview', () => {
  let store = {
    version: 1,
    activeByChatId: {},
    sessions: []
  };

  store = recordSessionTurn(store, {
    chatId: 'chat-a',
    backend: 'codex',
    codexSessionId: 'thread-1',
    cwd: '/tmp/a',
    userPrompt: '帮我看下日志',
    assistantReply: '日志里是端口冲突'
  });

  const session = getRecentSessionByIndex(store, 1);
  const listText = renderSessionList(getRecentSessions(store, 5, 'codex'), 'thread-1');
  const previewText = renderSelectedSessionPreview(session, { commandPrefix: '/codex' });
  const adapterPrompt = buildAdapterPrompt({
    userPrompt: '继续查',
    selectedSession: session,
    includeSelectedContext: true
  });

  assert.match(listText, /1\./);
  assert.match(listText, /后端: Codex/);
  assert.match(listText, /session_id:/);
  assert.match(listText, /工作空间:/);
  assert.match(listText, /\[当前\]/);
  assert.match(listText, /最后一条消息: .*?\n\n发 `\/codex 编号`/s);
  assert.match(previewText, /Codex session/);
  assert.match(previewText, /最后两条消息/);
  assert.equal(adapterPrompt, '继续查');

  store = recordSessionTurn(store, {
    chatId: 'chat-b',
    backend: 'claude',
    codexSessionId: 'thread-2',
    cwd: '/tmp/b',
    userPrompt: '继续排查',
    assistantReply: '我接着看'
  });

  const claudeSession = getRecentSessionByIndex(store, 1, 'claude');
  const claudePreview = renderSelectedSessionPreview(claudeSession);
  assert.match(claudePreview, /Claude Code session/);
  assert.match(claudePreview, /`\/cc 你的消息`/);
});
