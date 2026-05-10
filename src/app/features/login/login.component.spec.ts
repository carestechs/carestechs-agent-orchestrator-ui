// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { LoginComponent } from './login.component';
import { AuthService } from '../../core/auth.service';
import { ToastService } from '../../shared/toast.service';
import { ProblemDetailsError } from '../../core/problem-details.error';

interface SetupOpts {
  redirect?: string;
  reason?: string;
  loginImpl?: () => unknown;
}

function setup(opts: SetupOpts = {}) {
  const params: Record<string, string> = {};
  if (opts.redirect !== undefined) params['redirect'] = opts.redirect;
  if (opts.reason !== undefined) params['reason'] = opts.reason;

  const loginSpy = vi.fn(opts.loginImpl ?? (() => of({ authenticated: true })));
  const navSpy = vi.fn().mockResolvedValue(true);
  const toastErrorSpy = vi.fn();
  const toastSuccessSpy = vi.fn();
  const toastInfoSpy = vi.fn();

  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParamMap: convertToParamMap(params) } },
      },
      { provide: Router, useValue: { navigateByUrl: navSpy, url: '/login' } },
      { provide: AuthService, useValue: { login: loginSpy } },
      {
        provide: ToastService,
        useValue: { error: toastErrorSpy, success: toastSuccessSpy, info: toastInfoSpy },
      },
    ],
  });

  const fixture = TestBed.createComponent(LoginComponent);
  fixture.detectChanges();
  return {
    fixture,
    component: fixture.componentInstance,
    loginSpy,
    navSpy,
    toastErrorSpy,
    toastSuccessSpy,
    toastInfoSpy,
  };
}

describe('LoginComponent', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  it('navigates to whitelisted ?redirect on success', async () => {
    const { component, navSpy } = setup({ redirect: '/runs/abc' });
    component.passphrase.set('hunter2');
    await component.submit();
    expect(navSpy).toHaveBeenCalledWith('/runs/abc');
  });

  it('defaults to /runs when no redirect provided', async () => {
    const { component, navSpy } = setup();
    component.passphrase.set('hunter2');
    await component.submit();
    expect(navSpy).toHaveBeenCalledWith('/runs');
  });

  it('rejects unsafe redirects (// and https://)', async () => {
    {
      const { component, navSpy } = setup({ redirect: '//evil.com' });
      component.passphrase.set('hunter2');
      await component.submit();
      expect(navSpy).toHaveBeenCalledWith('/runs');
    }
    TestBed.resetTestingModule();
    {
      const { component, navSpy } = setup({ redirect: 'https://evil.com' });
      component.passphrase.set('hunter2');
      await component.submit();
      expect(navSpy).toHaveBeenCalledWith('/runs');
    }
  });

  it('shows inline error on invalid-passphrase and does not toast', async () => {
    const err = new ProblemDetailsError({
      type: 'about:blank',
      title: 'Invalid passphrase',
      status: 401,
      code: 'invalid-passphrase',
    });
    const { component, fixture, toastErrorSpy } = setup({
      loginImpl: () => throwError(() => err),
    });
    component.passphrase.set('wrong');
    await component.submit();
    fixture.detectChanges();
    expect(component.errorCode()).toBe('invalid-passphrase');
    expect(component.errorMessage()).toBe('Incorrect passphrase.');
    expect(component.submitting()).toBe(false);
    const node = fixture.nativeElement.querySelector('#login-error') as HTMLElement | null;
    expect(node?.textContent).toContain('Incorrect passphrase.');
    expect(toastErrorSpy).not.toHaveBeenCalled();
  });

  it('renders the expired banner when ?reason=expired', () => {
    const { fixture } = setup({ reason: 'expired' });
    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html).toContain('Your session expired');
  });

  it('does not render the expired banner without ?reason', () => {
    const { fixture } = setup();
    const html = (fixture.nativeElement as HTMLElement).innerHTML;
    expect(html).not.toContain('Your session expired');
  });

  it('guards against double-submit while a request is in flight', () => {
    // Return an Observable that never emits — submit() awaits firstValueFrom.
    const inflight = new Promise<never>(() => undefined);
    const loginSpy = vi.fn(() => ({
      subscribe: (obs: { error: (e: unknown) => void }) => {
        // never completes; just hold the subscriber
        void obs; void inflight;
        return { unsubscribe: () => undefined };
      },
    }));
    const { component } = setup({ loginImpl: loginSpy as unknown as () => unknown });
    component.passphrase.set('hunter2');
    void component.submit();
    void component.submit();
    expect(loginSpy).toHaveBeenCalledTimes(1);
  });
});
