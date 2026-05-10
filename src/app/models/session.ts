// After FEAT-003 T-031 the gate is SPA-side (sessionStorage); there is no
// server-issued expiration. `expiresAt` is preserved as an optional field for
// forward compatibility with real auth (FEAT-004), where the orchestrator
// would issue a real session and a real expiry.
export type OperatorSession =
  | { authenticated: true; expiresAt?: string }
  | { authenticated: false };
