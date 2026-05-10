// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter, type Route, type UrlSegment, type UrlTree } from '@angular/router';
import { firstValueFrom, isObservable } from 'rxjs';
import { authGuard } from './auth.guard';
import { unlock, lock } from './operator-gate';

function asSegments(path: string): UrlSegment[] {
  return path
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
    .map((p) => ({ path: p, parameters: {} } as UrlSegment));
}

async function run(target: string): Promise<true | UrlTree> {
  const result = TestBed.runInInjectionContext(() =>
    authGuard({} as Route, asSegments(target)),
  );
  if (typeof result === 'boolean') return result as true;
  if (isObservable(result)) {
    const v = await firstValueFrom(result);
    return v as true | UrlTree;
  }
  return result as UrlTree;
}

beforeEach(() => {
  sessionStorage.clear();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
});

afterEach(() => {
  sessionStorage.clear();
});

describe('authGuard', () => {
  it('returns a UrlTree pointing at /login when the gate is locked and target is non-trivial', async () => {
    const result = await run('/runs/abc');
    // It should be a UrlTree, not boolean true.
    expect(typeof result).not.toBe('boolean');
    const urlTree = result as UrlTree;
    expect(urlTree.toString()).toContain('/login');
    expect(urlTree.toString()).toContain('redirect=');
  });

  it('returns a UrlTree to /login without redirect for / or /login', async () => {
    const result = await run('/');
    const urlTree = result as UrlTree;
    expect(urlTree.toString()).toBe('/login');
  });

  it('returns true when the gate is unlocked', async () => {
    unlock();
    const result = await run('/runs');
    expect(result).toBe(true);
    lock();
  });
});

