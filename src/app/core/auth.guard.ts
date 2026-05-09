import { inject } from '@angular/core';
import { Router, type CanMatchFn, type UrlTree } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from './auth.service';

export const authGuard: CanMatchFn = (_route, segments) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.authenticated()) return true;

  const target = '/' + segments.map((s) => s.path).join('/');
  const skipRedirect = target === '/' || target === '/login';
  const loginUrl = (): UrlTree =>
    skipRedirect
      ? router.parseUrl('/login')
      : router.parseUrl('/login?redirect=' + encodeURIComponent(target));

  return auth.me().pipe(
    map((session) => (session.authenticated ? true : loginUrl())),
    catchError(() => of(router.parseUrl('/login'))),
  );
};
