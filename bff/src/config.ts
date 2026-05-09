import type { BffConfig } from './session/types.js';

const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;

let cached: BffConfig | undefined;

function readEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.length > 0 ? value : undefined;
}

function requireInProd(name: string, value: string | undefined, isProduction: boolean): string {
  if (value !== undefined) return value;
  if (isProduction) {
    throw new Error(
      `Missing required env var ${name}. Production boot aborts with a missing secret.`,
    );
  }
  return `dev-${name.toLowerCase()}-CHANGE-ME`;
}

export function loadConfig(): BffConfig {
  if (cached) return cached;

  const isProduction = (process.env['NODE_ENV'] ?? 'development') === 'production';

  const port = Number.parseInt(process.env['PORT'] ?? '4000', 10);
  const sessionSecret = requireInProd('SESSION_SECRET', readEnv('SESSION_SECRET'), isProduction);
  const operatorPassphrase = requireInProd(
    'ORCHESTRATOR_OPERATOR_PASSPHRASE',
    readEnv('ORCHESTRATOR_OPERATOR_PASSPHRASE'),
    isProduction,
  );
  const orchestratorBaseUrl = requireInProd(
    'ORCHESTRATOR_BASE_URL',
    readEnv('ORCHESTRATOR_BASE_URL'),
    isProduction,
  );
  const orchestratorApiKey = requireInProd(
    'ORCHESTRATOR_API_KEY',
    readEnv('ORCHESTRATOR_API_KEY'),
    isProduction,
  );

  cached = {
    port,
    isProduction,
    sessionSecret,
    operatorPassphrase,
    sessionTtlMs: EIGHT_HOURS_MS,
    orchestratorBaseUrl: orchestratorBaseUrl.replace(/\/+$/, ''),
    orchestratorApiKey,
  };
  return cached;
}

// Test-only escape hatch.
export function resetConfigCache(): void {
  cached = undefined;
}

// Log-safe summary — never includes secret values.
export function configSummary(c: BffConfig): Record<string, unknown> {
  return {
    port: c.port,
    isProduction: c.isProduction,
    sessionSecretConfigured: c.sessionSecret.length > 0,
    operatorPassphraseConfigured: c.operatorPassphrase.length > 0,
    orchestratorBaseUrl: c.orchestratorBaseUrl,
    orchestratorApiKeyConfigured: c.orchestratorApiKey.length > 0,
    sessionTtlMs: c.sessionTtlMs,
  };
}
