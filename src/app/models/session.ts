export type OperatorSession =
  | { authenticated: true; expiresAt: string }
  | { authenticated: false };
