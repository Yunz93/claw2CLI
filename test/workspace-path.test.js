import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  normalizeWorkspaceInput,
  resolveWorkspacePath
} from '../src/workspace-path.js';

test('normalizeWorkspaceInput expands leading tilde', () => {
  assert.equal(normalizeWorkspaceInput('~/repo/demo'), path.join(os.homedir(), 'repo/demo'));
  assert.equal(normalizeWorkspaceInput('~'), os.homedir());
  assert.equal(normalizeWorkspaceInput('"~/quoted/path"'), path.join(os.homedir(), 'quoted/path'));
});

test('resolveWorkspacePath creates missing directories', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claw2cli-workspace-'));
  const target = path.join(root, 'nested', 'demo');

  const resolved = resolveWorkspacePath(target, root);

  assert.equal(resolved.ok, true);
  assert.equal(resolved.cwd, target);
  assert.equal(resolved.created, true);
  assert.equal(fs.statSync(target).isDirectory(), true);

  fs.rmSync(root, { recursive: true, force: true });
});

test('resolveWorkspacePath reports a clearer error for file paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'claw2cli-workspace-'));
  const filePath = path.join(root, 'not-a-dir');
  fs.writeFileSync(filePath, 'hello');

  const resolved = resolveWorkspacePath(filePath, root);

  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, 'not_directory');
  assert.match(resolved.message, /不是文件夹/);

  fs.rmSync(root, { recursive: true, force: true });
});
