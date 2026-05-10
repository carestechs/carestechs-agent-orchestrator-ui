// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { safeRedirectTarget } from './safe-redirect';

describe('safeRedirectTarget', () => {
  it('falls back to /runs for null/empty', () => {
    expect(safeRedirectTarget(null)).toBe('/runs');
    expect(safeRedirectTarget('')).toBe('/runs');
    expect(safeRedirectTarget('   ')).toBe('/runs');
  });

  it('passes through clean same-origin paths', () => {
    expect(safeRedirectTarget('/runs')).toBe('/runs');
    expect(safeRedirectTarget('/runs/abc-123')).toBe('/runs/abc-123');
  });

  it('rejects protocol-relative URLs', () => {
    expect(safeRedirectTarget('//evil.com')).toBe('/runs');
    expect(safeRedirectTarget('//evil.com/runs')).toBe('/runs');
  });

  it('rejects absolute URLs', () => {
    expect(safeRedirectTarget('http://evil.com/runs')).toBe('/runs');
    expect(safeRedirectTarget('https://evil.com')).toBe('/runs');
    expect(safeRedirectTarget('HTTPS://evil.com')).toBe('/runs');
  });

  it('rejects relative paths without leading slash', () => {
    expect(safeRedirectTarget('runs')).toBe('/runs');
    expect(safeRedirectTarget('../runs')).toBe('/runs');
  });

  it('rejects header-injection bytes', () => {
    expect(safeRedirectTarget('/runs\nSet-Cookie: x=1')).toBe('/runs');
    expect(safeRedirectTarget('/runs\rfoo')).toBe('/runs');
    expect(safeRedirectTarget('\\evil')).toBe('/runs');
    expect(safeRedirectTarget('/a\\b')).toBe('/runs');
  });
});
