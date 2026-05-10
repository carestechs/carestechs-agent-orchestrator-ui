import { inject } from '@angular/core';
import { Router, type CanMatchFn, type UrlTree } from '@angular/router';
import { map } from 'rxjs';
import { AuthService } from './auth.service';
import { isUnlocked } from './operator-gate';

export const authGuard: CanMatchFn = (_route, segments) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.authenticated()) return true;

  if (isUnlocked()) {
    // Sync the in-memory signal so subsequent checks short-circuit.
    return auth.me().pipe(map(() => true));
  }

  const target = '/' + segments.map((s) => s.path).join('/');
  const skipRedirect = target === '/' || target === '/login';
  const loginUrl = (): UrlTree =>
    skipRedirect
      ? router.parseUrl('/login')
      : router.parseUrl('/login?redirect=' + encodeURIComponent(target));

  return loginUrl();
};
