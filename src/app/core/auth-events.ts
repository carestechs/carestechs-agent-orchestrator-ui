import { signal } from '@angular/core';

// Monotonic counter — bumped whenever ApiClient or TraceStreamService observes
// a 401 unauthenticated. Decoupled from AuthService to avoid a circular
// dependency between the API client and the auth service.
export const authExpired = signal(0);

export function notifyAuthExpired(): void {
  authExpired.update((n) => n + 1);
}
