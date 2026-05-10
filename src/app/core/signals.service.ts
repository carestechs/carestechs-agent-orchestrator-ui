import { Injectable, inject } from '@angular/core';
import type { Observable } from 'rxjs';
import { map } from 'rxjs';
import { ApiClient } from './api-client';
import type { SignalReceipt, SignalRequest } from '../models';

export interface SignalSubmitResult {
  data: SignalReceipt;
  alreadyReceived: boolean;
}

@Injectable({ providedIn: 'root' })
export class SignalsService {
  private readonly api = inject(ApiClient);

  // Per CLAUDE.md > Idempotent retries: callers may submit the same signal
  // freely. The orchestrator returns meta.alreadyReceived: true on replays;
  // we surface that flag so the run-detail screen can pick the right toast.
  submit(runId: string, body: SignalRequest): Observable<SignalSubmitResult> {
    return this.api
      .post<SignalReceipt>(`/v1/runs/${encodeURIComponent(runId)}/signals`, body)
      .pipe(
        map(({ data, meta }) => ({
          data,
          alreadyReceived: meta?.alreadyReceived === true,
        })),
      );
  }
}
