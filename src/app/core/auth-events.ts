import { signal } from '@angular/core';

// Monotonic counter — bumped whenever ApiClient or TraceStreamService observes
// a 401 unauthenticated. Decoupled from AuthService to avoid a circular
// dependency between the API client and the auth service.
//
// After FEAT-003 T-031 there is no cookie-session expiry. The 401 trigger
// source is now the orchestrator itself (rotated/revoked API key, mid-stream
// auth failure). Same channel shape; different upstream cause.
export const authExpired = signal(0);

export function notifyAuthExpired(): void {
  authExpired.update((n) => n + 1);
}
