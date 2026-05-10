// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isUnlocked, lock, unlock } from './operator-gate';

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('operator-gate', () => {
  it('isUnlocked returns false when storage is empty', () => {
    expect(isUnlocked()).toBe(false);
  });

  it('unlock then isUnlocked returns true', () => {
    unlock();
    expect(isUnlocked()).toBe(true);
  });

  it('lock clears the flag', () => {
    unlock();
    expect(isUnlocked()).toBe(true);
    lock();
    expect(isUnlocked()).toBe(false);
  });

  it('isUnlocked fails closed when sessionStorage.getItem throws', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage disabled');
    });
    expect(isUnlocked()).toBe(false);
    spy.mockRestore();
  });

  it('unlock is a no-op when sessionStorage.setItem throws (does not propagate)', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });
    expect(() => unlock()).not.toThrow();
  });

  it('lock is a no-op when sessionStorage.removeItem throws (does not propagate)', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('Storage disabled');
    });
    expect(() => lock()).not.toThrow();
  });

  it('only stores the literal string "true" — accidental truthy values must not unlock', () => {
    // Direct write of a non-"true" value (simulating bad input) should not register.
    sessionStorage.setItem('ao.operator.unlocked', '1');
    expect(isUnlocked()).toBe(false);
    sessionStorage.setItem('ao.operator.unlocked', 'yes');
    expect(isUnlocked()).toBe(false);
  });
});
