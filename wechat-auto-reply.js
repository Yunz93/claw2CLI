#!/usr/bin/env node
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function usage() {
  console.error('usage: wechat-auto-reply.js <chat_id> <text> [cwd] [codex_session_id]');
  process.exit(2);
}

const [, , chatId, text, cwd, codexSessionId] = process.argv;
if (!chatId || !text) usage();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const triggerScriptPath = path.join(__dirname, 'wechat-trigger.js');
const rawPromptMode = process.env.MAC_CLI_BRIDGE_RAW_PROMPT === '1';

const trimmed = text.trim();
if (!rawPromptMode && !/^\/(codex|claude|cc|kimi)(?:\s|$)/i.test(trimmed)) {
  console.log(JSON.stringify({ ok: false, ignored: true, reason: 'missing_prefix' }, null, 2));
  process.exit(0);
}

const triggerArgs = [
  'node',
  triggerScriptPath,
  chatId,
  trimmed
];
if (cwd) {
  triggerArgs.push(cwd);
}
if (codexSessionId) {
  if (!cwd) {
    triggerArgs.push('');
  }
  triggerArgs.push(codexSessionId);
}

execFile(
  '/usr/bin/env',
  triggerArgs,
  { maxBuffer: 1024 * 1024 * 8, env: process.env },
  (err, stdout, stderr) => {
    if (err) {
      console.log(JSON.stringify({ ok: false, error: String(err), stderr, stdout }, null, 2));
      process.exit(1);
    }
    const payload = JSON.parse(stdout);
    const text =
      payload?.result?.result?.finalText ||
      payload?.result?.finalText ||
      payload?.finalText ||
      null;
    console.log(JSON.stringify({
      ok: true,
      triggered: payload.triggered === true,
      shouldReply: Boolean(text),
      replyText: text,
      meta:
        payload?.meta ||
        payload?.result?.meta ||
        null,
      codexSessionId:
        payload?.result?.result?.codexSessionId ||
        payload?.result?.codexSessionId ||
        payload?.codexSessionId ||
        null,
      raw: payload
    }, null, 2));
  }
);
