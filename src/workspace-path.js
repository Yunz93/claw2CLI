import { mkdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

function buildSuccess(candidate, input, created = false) {
  return {
    ok: true,
    cwd: candidate,
    projectName: path.basename(candidate) || candidate,
    input,
    created
  };
}

function buildFailure(input, reason, message) {
  return {
    ok: false,
    input,
    reason,
    message
  };
}

export function normalizeWorkspaceInput(workspacePath) {
  const trimmed = (workspacePath || '').trim();
  if (!trimmed) return '';

  const unquoted = (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  )
    ? trimmed.slice(1, -1).trim()
    : trimmed;

  if (unquoted === '~') {
    return os.homedir();
  }

  if (unquoted.startsWith('~/')) {
    return path.join(os.homedir(), unquoted.slice(2));
  }

  return unquoted;
}

export function resolveWorkspacePath(workspacePath, baseCwd) {
  const normalizedPath = normalizeWorkspaceInput(workspacePath);
  if (!normalizedPath) {
    return buildFailure(normalizedPath, 'missing_path', '请带上工作空间路径，例如 `/codex new ~/path/to/workspace`。');
  }

  const candidates = path.isAbsolute(normalizedPath)
    ? [path.resolve(normalizedPath)]
    : [path.resolve(baseCwd, normalizedPath)];

  for (const candidate of [...new Set(candidates)]) {
    try {
      if (!statSync(candidate).isDirectory()) {
        return buildFailure(
          normalizedPath,
          'not_directory',
          `路径 ${candidate} 已存在，但不是文件夹。请换一个目录路径。`
        );
      }
      return buildSuccess(candidate, normalizedPath, false);
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        try {
          mkdirSync(candidate, { recursive: true });
          return buildSuccess(candidate, normalizedPath, true);
        } catch (mkdirErr) {
          if (mkdirErr && mkdirErr.code === 'EACCES') {
            return buildFailure(
              normalizedPath,
              'permission_denied',
              `没有权限创建工作空间 ${candidate}。请换一个可写目录，或先手动创建。`
            );
          }
          if (mkdirErr && mkdirErr.code === 'ENOTDIR') {
            return buildFailure(
              normalizedPath,
              'parent_not_directory',
              `无法创建工作空间 ${candidate}，因为它的上级路径里有一段不是文件夹。`
            );
          }
          return buildFailure(
            normalizedPath,
            'mkdir_failed',
            `创建工作空间 ${candidate} 失败：${mkdirErr?.message || String(mkdirErr)}`
          );
        }
      }

      if (err && err.code === 'EACCES') {
        return buildFailure(
          normalizedPath,
          'permission_denied',
          `没有权限访问工作空间 ${candidate}。请换一个可读写目录。`
        );
      }

      return buildFailure(
        normalizedPath,
        'stat_failed',
        `检查工作空间 ${candidate} 失败：${err?.message || String(err)}`
      );
    }
  }

  return buildFailure(normalizedPath, 'unresolved', `无法解析工作空间 ${normalizedPath}。`);
}
