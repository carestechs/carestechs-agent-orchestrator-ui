import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { map } from 'rxjs';
import { ApiClient } from './api-client';
import type { Agent } from '../models';

@Injectable({ providedIn: 'root' })
export class AgentsService {
  private readonly api = inject(ApiClient);

  // For v1 the orchestrator returns 1–5 agents (per FEAT-001 risks); no
  // pagination params yet. If/when cardinality grows we'll add the same
  // shape as RunsService.list.
  // No in-memory cache — every call is a fresh fetch. Callers that need
  // a "refresh" affordance just invoke list() again. Do not add memoization
  // here without revisiting the run-start empty-state UX (T-025).
  list(): Observable<Agent[]> {
    return this.api.get<Agent[]>('/api/v1/agents').pipe(map(({ data }) => data));
  }
}
