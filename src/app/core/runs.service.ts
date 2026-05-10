import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { map } from 'rxjs';
import { ApiClient, type Params } from './api-client';
import { clampPageSize } from './pagination';
import type { Pagination, RunDetail, RunStatus, RunSummary, StartRunRequest } from '../models';

export interface RunListFilters {
  status?: RunStatus;
  agentRef?: string;
  page?: number;
  pageSize?: number;
}

export interface RunListResult {
  data: RunSummary[];
  meta: Pagination;
}

@Injectable({ providedIn: 'root' })
export class RunsService {
  private readonly api = inject(ApiClient);

  list(filters: RunListFilters = {}): Observable<RunListResult> {
    const params: Params = {
      page: filters.page ?? 1,
      pageSize: clampPageSize(filters.pageSize),
    };
    if (filters.status) params['status'] = filters.status;
    if (filters.agentRef) params['agentRef'] = filters.agentRef;

    return this.api.get<RunSummary[]>('/v1/runs', params).pipe(
      map(({ data, meta }) => ({
        data,
        meta: isPagination(meta) ? meta : { page: 1, pageSize: clampPageSize(filters.pageSize), total: data.length },
      })),
    );
  }

  get(runId: string): Observable<RunDetail> {
    return this.api
      .get<RunDetail>(`/v1/runs/${encodeURIComponent(runId)}`)
      .pipe(map(({ data }) => data));
  }

  // 409 run-already-terminal flows out as ProblemDetailsError. The run-detail
  // screen (T-018) catches it, shows a toast, and refreshes; this service
  // does not retry.
  cancel(runId: string): Observable<RunSummary> {
    return this.api
      .post<RunSummary>(`/v1/runs/${encodeURIComponent(runId)}/cancel`, {})
      .pipe(map(({ data }) => data));
  }

  // POST /v1/runs — orchestrator returns 202 with the new RunSummary.
  // Errors flow as ProblemDetailsError via ApiClient (400 invalid-intake,
  // 404 agent-not-found, 502 upstream-unavailable). Caller maps them to
  // the correct UI surface (inline / page-level).
  startRun(req: StartRunRequest): Observable<RunSummary> {
    return this.api.post<RunSummary>('/v1/runs', req).pipe(map(({ data }) => data));
  }
}

function isPagination(meta: unknown): meta is Pagination {
  if (typeof meta !== 'object' || meta === null) return false;
  const r = meta as Record<string, unknown>;
  return typeof r['page'] === 'number' && typeof r['pageSize'] === 'number' && typeof r['total'] === 'number';
}
