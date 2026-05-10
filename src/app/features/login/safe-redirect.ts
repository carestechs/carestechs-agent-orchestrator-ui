// Same-origin redirect-target whitelist. Anything that doesn't begin with
// exactly one '/' (and contains no header-injection or origin-jump bytes)
// falls back to '/runs'. The login open-redirect threat model is documented
// in plans/plan-T-014-login-screen.md.
const FALLBACK = '/runs';

export function safeRedirectTarget(raw: string | null | undefined): string {
  if (raw == null) return FALLBACK;
  const value = raw.trim();
  if (value.length === 0) return FALLBACK;
  if (value.startsWith('//')) return FALLBACK;
  if (/^https?:/i.test(value)) return FALLBACK;
  if (!value.startsWith('/')) return FALLBACK;
  if (value.includes('\\') || value.includes('\r') || value.includes('\n')) return FALLBACK;
  return value;
}
