// SPA-side operator gate. Stores a flag in sessionStorage when the operator
// successfully types the configured passphrase. Per-tab, dies on tab close.
// Fail closed when storage is unavailable (Safari private mode) — better a
// re-prompt than a false-unlock.
//
// This is NOT real authentication. The orchestrator deployment is gated by
// network position; this UI gate just keeps casual tab-takeover from being a
// free action. Real per-operator auth is FEAT-004.

const KEY = 'ao.operator.unlocked';

export function isUnlocked(): boolean {
  try {
    return sessionStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

export function unlock(): void {
  try {
    sessionStorage.setItem(KEY, 'true');
  } catch {
    /* best-effort */
  }
}

export function lock(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* best-effort */
  }
}
