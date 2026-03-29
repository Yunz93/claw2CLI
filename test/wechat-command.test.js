import test from 'node:test';
import assert from 'node:assert/strict';

import {
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
    type: 'enter'
  });

  assert.deepEqual(parseCodexCommand('/codex list'), {
    ok: true,
    type: 'list',
    limit: 5
  });

  assert.deepEqual(parseCodexCommand('/codex list 9'), {
    ok: true,
    type: 'list',
    limit: 9
  });

  assert.deepEqual(parseCodexCommand('/codex 2 继续'), {
    ok: true,
    type: 'select',
    index: 2,
    prompt: '继续'
  });

  assert.deepEqual(parseCodexCommand('/codex 3'), {
    ok: true,
    type: 'select',
    index: 3,
    prompt: ''
  });

  assert.deepEqual(parseCodexCommand('/codex 修 bug'), {
    ok: true,
    type: 'prompt',
    prompt: '修 bug'
  });
});

test('session store tracks active session and recent messages', () => {
  let store = rememberActiveSession({
    version: 1,
    activeByChatId: {},
    sessions: []
  }, {
    chatId: 'chat-a',
    codexSessionId: 'thread-1',
    cwd: '/tmp/a'
  });

  store = recordSessionTurn(store, {
    chatId: 'chat-a',
    codexSessionId: 'thread-1',
    cwd: '/tmp/a',
    userPrompt: '第一问',
    assistantReply: '第一答'
  });

  store = recordSessionTurn(store, {
    chatId: 'chat-b',
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

test('session store keeps only the most recently active session per cwd', () => {
  let store = {
    version: 1,
    activeByChatId: {},
    sessions: []
  };

  store = recordSessionTurn(store, {
    chatId: 'chat-a',
    codexSessionId: 'thread-1',
    cwd: '/same/project',
    userPrompt: '旧会话',
    assistantReply: '旧回答'
  });

  store = recordSessionTurn(store, {
    chatId: 'chat-a',
    codexSessionId: 'thread-2',
    cwd: '/same/project',
    userPrompt: '新会话',
    assistantReply: '新回答'
  });

  store = recordSessionTurn(store, {
    chatId: 'chat-a',
    codexSessionId: 'thread-3',
    cwd: '/other/project',
    userPrompt: '别的目录',
    assistantReply: '别的回答'
  });

  const recentSessions = getRecentSessions(store, 5);
  assert.equal(recentSessions.length, 2);
  assert.equal(recentSessions.some(session => session.codexSessionId === 'thread-1'), false);
  assert.equal(recentSessions.some(session => session.codexSessionId === 'thread-2'), true);
  assert.equal(recentSessions.some(session => session.codexSessionId === 'thread-3'), true);
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
      cwd: '/same/project',
      createdAt: 1,
      activatedAt: 1000,
      turns: [{ role: 'user', text: 'old', ts: 1 }]
    },
    {
      codexSessionId: 'thread-b',
      chatId: '',
      cwd: '/same/project',
      createdAt: 2,
      activatedAt: 2000,
      turns: [{ role: 'user', text: 'new', ts: 2 }]
    },
    {
      codexSessionId: 'thread-c',
      chatId: '',
      cwd: '/other/project',
      createdAt: 3,
      activatedAt: 3000,
      turns: [{ role: 'assistant', text: 'reply', ts: 3 }]
    }
  ]);

  const recentSessions = getRecentSessions(merged, 5);
  assert.equal(recentSessions.length, 2);
  assert.equal(recentSessions[0].codexSessionId, 'thread-c');
  assert.equal(recentSessions[1].codexSessionId, 'thread-b');
});

test('render helpers expose numbered sessions and selected preview', () => {
  let store = {
    version: 1,
    activeByChatId: {},
    sessions: []
  };

  store = recordSessionTurn(store, {
    chatId: 'chat-a',
    codexSessionId: 'thread-1',
    cwd: '/tmp/a',
    userPrompt: '帮我看下日志',
    assistantReply: '日志里是端口冲突'
  });

  const session = getRecentSessionByIndex(store, 1);
  const listText = renderSessionList(getRecentSessions(store, 5), 'thread-1');
  const previewText = renderSelectedSessionPreview(session);
  const adapterPrompt = buildAdapterPrompt({
    userPrompt: '继续查',
    selectedSession: session,
    includeSelectedContext: true
  });

  assert.match(listText, /1\./);
  assert.match(listText, /session_id:/);
  assert.match(listText, /工作空间:/);
  assert.match(listText, /\[当前\]/);
  assert.match(listText, /最后一条消息: .*?\n\n发 `\/codex 编号`/s);
  assert.match(previewText, /最后两条消息/);
  assert.equal(adapterPrompt, '继续查');
});
