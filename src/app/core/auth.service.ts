import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, of, throwError } from 'rxjs';
import { tap } from 'rxjs';
import { authExpired } from './auth-events';
import { isUnlocked, lock, unlock } from './operator-gate';
import { ProblemDetailsError } from './problem-details.error';
import { environment } from '../../environments/environment';
import type { OperatorSession } from '../models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly router = inject(Router);

  private readonly _session = signal<OperatorSession | null>(null);
  readonly session = this._session.asReadonly();
  readonly authenticated = computed(() => this._session()?.authenticated === true);

  private lastHandledExpiry = authExpired();

  constructor() {
    effect(() => {
      const counter = authExpired();
      if (counter === this.lastHandledExpiry) return;
      this.lastHandledExpiry = counter;
      this.handleExpiry();
    });
  }

  // Reads the current gate state. No network. Kept as Observable<...> so
  // callers (authGuard, etc.) don't have to change shape during the migration.
  me(): Observable<OperatorSession> {
    return of({ authenticated: isUnlocked() } as OperatorSession).pipe(
      tap((s) => this._session.set(s)),
    );
  }

  login(passphrase: string): Observable<OperatorSession> {
    if (passphrase === environment.operatorPassphrase) {
      unlock();
      const session: OperatorSession = { authenticated: true };
      this._session.set(session);
      return of(session);
    }
    return throwError(
      () =>
        new ProblemDetailsError({
          type: 'about:blank',
          title: 'Incorrect passphrase.',
          status: 401,
          code: 'invalid-passphrase',
        }),
    );
  }

  logout(): Observable<void> {
    lock();
    this._session.set({ authenticated: false });
    return of(undefined);
  }

  private handleExpiry(): void {
    const url = this.router.url;
    if (url.startsWith('/login')) return;
    lock();
    this._session.set({ authenticated: false });
    void this.router.navigateByUrl('/login?reason=expired', { replaceUrl: true });
  }
}
