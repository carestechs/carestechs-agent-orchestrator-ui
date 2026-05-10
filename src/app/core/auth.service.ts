import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { Observable } from 'rxjs';
import { map, tap } from 'rxjs';
import { ApiClient } from './api-client';
import { authExpired } from './auth-events';
import type { OperatorSession } from '../models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiClient);
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

  me(): Observable<OperatorSession> {
    return this.api.get<OperatorSession>('/auth/me').pipe(
      map(({ data }) => data),
      tap((s) => this._session.set(s)),
    );
  }

  login(passphrase: string): Observable<OperatorSession> {
    return this.api.post<OperatorSession>('/auth/login', { passphrase }).pipe(
      map(({ data }) => data),
      tap((s) => this._session.set(s)),
    );
  }

  logout(): Observable<void> {
    return this.api.post<void>('/auth/logout', {}).pipe(
      map(() => undefined),
      tap(() => this._session.set({ authenticated: false })),
    );
  }

  private handleExpiry(): void {
    const url = this.router.url;
    if (url.startsWith('/login')) return;
    this._session.set({ authenticated: false });
    void this.router.navigateByUrl('/login?reason=expired', { replaceUrl: true });
  }
}
