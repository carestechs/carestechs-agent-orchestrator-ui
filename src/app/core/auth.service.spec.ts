// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { provideRouter, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { authExpired, notifyAuthExpired } from './auth-events';

let auth: AuthService;
let httpMock: HttpTestingController;
let router: Router;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
  });
  router = TestBed.inject(Router);
  auth = TestBed.inject(AuthService);
  httpMock = TestBed.inject(HttpTestingController);
});

afterEach(() => {
  httpMock.verify();
});

describe('AuthService', () => {
  it('updates the session signal on login', () => {
    let result: unknown;
    auth.login('pw').subscribe((s) => (result = s));
    const req = httpMock.expectOne('/auth/login');
    expect(req.request.body).toEqual({ passphrase: 'pw' });
    req.flush({
      data: { authenticated: true, expiresAt: '2026-05-09T12:00:00Z' },
      meta: null,
    });
    expect(result).toEqual({ authenticated: true, expiresAt: '2026-05-09T12:00:00Z' });
    expect(auth.authenticated()).toBe(true);
  });

  it('clears the session signal on logout', () => {
    auth.login('pw').subscribe();
    httpMock
      .expectOne('/auth/login')
      .flush({ data: { authenticated: true, expiresAt: '2026-05-09T12:00:00Z' }, meta: null });
    expect(auth.authenticated()).toBe(true);

    auth.logout().subscribe();
    httpMock.expectOne('/auth/logout').flush(null, { status: 200, statusText: 'OK' });
    expect(auth.authenticated()).toBe(false);
  });

  it('redirects to /login?reason=expired when authExpired bumps mid-session', async () => {
    const navSpy = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    Object.defineProperty(router, 'url', { get: () => '/runs', configurable: true });

    notifyAuthExpired();
    await Promise.resolve();
    TestBed.flushEffects();

    expect(navSpy).toHaveBeenCalledWith('/login?reason=expired', { replaceUrl: true });
    expect(auth.authenticated()).toBe(false);
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
