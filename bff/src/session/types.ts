export interface SessionPayload {
  sub: 'operator';
  iat: number;
  exp: number;
}

export interface BffConfig {
  port: number;
  isProduction: boolean;
  sessionSecret: string;
  operatorPassphrase: string;
  sessionTtlMs: number;
  orchestratorBaseUrl: string;
  orchestratorApiKey: string;
}
