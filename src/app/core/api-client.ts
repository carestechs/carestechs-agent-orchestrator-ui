import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import type { Observable } from 'rxjs';
import { catchError, map, throwError } from 'rxjs';
import { ProblemDetailsError } from './problem-details.error';
import { notifyAuthExpired } from './auth-events';
import type { Envelope, EnvelopeMeta } from '../models';

export type Params = Record<string, string | number | boolean | undefined | null>;

export interface UnwrappedEnvelope<T> {
  data: T;
  meta: EnvelopeMeta | null;
}

const PROBLEM_JSON = 'application/problem+json';

@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);

  get<T>(path: string, params?: Params): Observable<UnwrappedEnvelope<T>> {
    return this.send<T>(this.http.get<Envelope<T>>(path, this.opts(params)), path);
  }

  post<T>(path: string, body: unknown): Observable<UnwrappedEnvelope<T>> {
    return this.send<T>(this.http.post<Envelope<T>>(path, body, this.opts()), path);
  }

  delete<T>(path: string): Observable<UnwrappedEnvelope<T>> {
    return this.send<T>(this.http.delete<Envelope<T>>(path, this.opts()), path);
  }

  private send<T>(source: Observable<Envelope<T>>, path: string): Observable<UnwrappedEnvelope<T>> {
    return source.pipe(
      map((env) => ({ data: env?.data as T, meta: env?.meta ?? null })),
      catchError((err: unknown) => throwError(() => this.toProblem(err, path))),
    );
  }

  private opts(params?: Params): {
    withCredentials: true;
    params?: HttpParams;
  } {
    if (!params) return { withCredentials: true };
    let httpParams = new HttpParams();
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      httpParams = httpParams.set(key, String(value));
    }
    return { withCredentials: true, params: httpParams };
  }

  private toProblem(err: unknown, path: string): ProblemDetailsError {
    if (!(err instanceof HttpErrorResponse)) {
      return new ProblemDetailsError({
        type: 'about:blank',
        title: 'Unexpected error',
        status: 0,
        code: 'unknown',
      });
    }

    const ct = err.headers.get('content-type') ?? '';
    let problem: ProblemDetailsError;
    if (ct.includes(PROBLEM_JSON) && typeof err.error === 'object' && err.error !== null) {
      problem = ProblemDetailsError.fromUnknown(err.status, err.error);
    } else {
      problem = ProblemDetailsError.fromUnknown(err.status, err.error);
    }

    if (problem.status === 401 && !this.isAuthProbe(path)) {
      notifyAuthExpired();
    }
    return problem;
  }

  private isAuthProbe(path: string): boolean {
    return path === '/auth/me' || path === '/auth/login';
  }
}
