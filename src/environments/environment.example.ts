// Copy this file to environment.ts (dev) and environment.prod.ts (prod) and
// fill in real values. Both real files are gitignored.
//
// SECURITY NOTE: orchestratorApiKey ships in the browser bundle by design —
// the orchestrator deployment is gated by network position, not by secret
// confidentiality. See docs/ARCHITECTURE.md § "Interim security posture"
// (added in FEAT-003 T-035). If that assumption ever stops being true, this
// posture is broken — do not assume otherwise.

export interface EnvironmentConfig {
  readonly production: boolean;
  readonly orchestratorBaseUrl: string;
  readonly orchestratorApiKey: string;
  readonly operatorPassphrase: string;
}

export const environment: EnvironmentConfig = {
  production: false,
  orchestratorBaseUrl: 'http://127.0.0.1:4100',
  orchestratorApiKey: 'replace-me',
  operatorPassphrase: 'replace-me',
};
