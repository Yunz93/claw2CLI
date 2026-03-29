const BACKEND_CONFIGS = {
  codex: {
    aliases: ['codex', 'codex-exec'],
    displayName: 'Codex',
    commandPrefix: '/codex'
  },
  claude: {
    aliases: ['claude', 'claude-code', 'claude-code-exec', 'cc'],
    displayName: 'Claude Code',
    commandPrefix: '/cc'
  },
  kimi: {
    aliases: ['kimi', 'kimi-cli', 'kimi-cli-exec'],
    displayName: 'Kimi CLI',
    commandPrefix: '/kimi'
  }
};

const BACKEND_LOOKUP = new Map(
  Object.entries(BACKEND_CONFIGS).flatMap(([backend, config]) => (
    [backend, ...config.aliases].map((alias) => [alias, backend])
  ))
);

export function normalizeBackendName(value, fallback = 'codex') {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase();
  return BACKEND_LOOKUP.get(normalized) || fallback;
}

export function isSupportedBackend(value) {
  return BACKEND_LOOKUP.has(String(value || '').trim().toLowerCase());
}

export function getBackendDisplayName(backend) {
  const canonical = normalizeBackendName(backend, 'codex');
  return BACKEND_CONFIGS[canonical]?.displayName || canonical;
}

export function getBackendCommandPrefix(backend) {
  const canonical = normalizeBackendName(backend, 'codex');
  return BACKEND_CONFIGS[canonical]?.commandPrefix || '/codex';
}

export function getBackendConfig(backend) {
  const canonical = normalizeBackendName(backend, 'codex');
  return BACKEND_CONFIGS[canonical] || BACKEND_CONFIGS.codex;
}

export function listSupportedBackends() {
  return Object.keys(BACKEND_CONFIGS);
}
