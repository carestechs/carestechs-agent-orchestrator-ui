// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { authExpired, notifyAuthExpired } from './auth-events';
import { isUnlocked } from './operator-gate';
import { ProblemDetailsError } from './problem-details.error';
import { environment } from '../../environments/environment';

let auth: AuthService;
let router: Router;

beforeEach(() => {
  sessionStorage.clear();
  TestBed.configureTestingModule({ providers: [provideRouter([])] });
  router = TestBed.inject(Router);
  auth = TestBed.inject(AuthService);
});

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('AuthService', () => {
  it('login(passphrase) with the matching value unlocks and sets the session signal', async () => {
    const result = await firstValueFrom(auth.login(environment.operatorPassphrase));
    expect(result).toEqual({ authenticated: true });
    expect(auth.authenticated()).toBe(true);
    expect(isUnlocked()).toBe(true);
  });

  it('login(passphrase) with a wrong value throws ProblemDetailsError(invalid-passphrase) and does not unlock', async () => {
    let caught: unknown;
    try {
      await firstValueFrom(auth.login('wrong-value'));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ProblemDetailsError);
    expect((caught as ProblemDetailsError).code).toBe('invalid-passphrase');
    expect((caught as ProblemDetailsError).status).toBe(401);
    expect(isUnlocked()).toBe(false);
    expect(auth.authenticated()).toBe(false);
  });

  it('logout locks the gate and clears the session signal', async () => {
    await firstValueFrom(auth.login(environment.operatorPassphrase));
    expect(auth.authenticated()).toBe(true);
    await firstValueFrom(auth.logout());
    expect(auth.authenticated()).toBe(false);
    expect(isUnlocked()).toBe(false);
  });

  it('me() reflects current sessionStorage state and syncs the signal', async () => {
    expect(auth.authenticated()).toBe(false);
    sessionStorage.setItem('ao.operator.unlocked', 'true');
    const session = await firstValueFrom(auth.me());
    expect(session.authenticated).toBe(true);
    expect(auth.authenticated()).toBe(true);
  });

  it('redirects to /login?reason=expired and clears the gate when authExpired bumps mid-session', async () => {
    // Unlock first so the expiry is observable.
    await firstValueFrom(auth.login(environment.operatorPassphrase));
    expect(isUnlocked()).toBe(true);

    const navSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    Object.defineProperty(router, 'url', { get: () => '/runs', configurable: true });

    notifyAuthExpired();
    await Promise.resolve();
    TestBed.flushEffects();

    expect(navSpy).toHaveBeenCalledWith('/login?reason=expired', { replaceUrl: true });
    expect(auth.authenticated()).toBe(false);
    expect(isUnlocked()).toBe(false);
  });

  it('does not redirect when already on /login', async () => {
    const navSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    Object.defineProperty(router, 'url', { get: () => '/login?reason=expired', configurable: true });

    notifyAuthExpired();
    await Promise.resolve();
    TestBed.flushEffects();

    expect(navSpy).not.toHaveBeenCalled();
  });

  it('exposes the expiry counter as a signal source', () => {
    const before = authExpired();
    notifyAuthExpired();
    expect(authExpired()).toBe(before + 1);
  });
});
