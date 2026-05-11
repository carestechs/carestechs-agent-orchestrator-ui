import {
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { RunsService } from '../../core/runs.service';
import { TraceStreamService } from '../../core/trace-stream.service';
import { ToastService } from '../../shared/toast.service';
import { ConfirmModalService } from '../../shared/confirm-modal.service';
import { RunStatusBadgeComponent } from '../../shared/run-status-badge.component';
import { ProblemDetailsError } from '../../core/problem-details.error';
import type { RunDetail, RunStatus, StepStatus } from '../../models';
import { groupTraceByStep } from './group-trace-by-step';
import { AwaitingSignalPanelComponent } from './awaiting-signal-panel.component';

@Component({
  selector: 'app-run-detail',
  standalone: true,
  imports: [RouterLink, RunStatusBadgeComponent, AwaitingSignalPanelComponent],
  templateUrl: './run-detail.component.html',
  styles: [],
})
export class RunDetailComponent {
  private readonly route = inject(ActivatedRoute);
  private readonly runsService = inject(RunsService);
  private readonly traceStream = inject(TraceStreamService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmModalService);
  private readonly destroyRef = inject(DestroyRef);

  readonly runId = signal<string>('');
  readonly run = signal<RunDetail | null>(null);
  readonly runLoading = signal<boolean>(true);
  readonly runError = signal<ProblemDetailsError | null>(null);
  readonly cancelling = signal<boolean>(false);

  readonly trace = this.traceStream.records;
  readonly streamStatus = this.traceStream.status;

  readonly isTerminal = computed(() => {
    const r = this.run();
    return !!r && (r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled');
  });

  readonly groupedTrace = computed(() => groupTraceByStep(this.trace()));

  readonly runStatusForPanel = computed<RunStatus>(() => this.run()?.status ?? 'running');

  constructor() {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = params.get('id');
      if (!id) return;
      if (id === this.runId()) return;
      this.traceStream.close();
      this.runId.set(id);
      this.run.set(null);
      this.runLoading.set(true);
      this.runError.set(null);
      void this.loadRun();
      this.traceStream.open(id);
    });

    this.destroyRef.onDestroy(() => this.traceStream.close());
  }

  async loadRun(): Promise<void> {
    this.runLoading.set(true);
    try {
      const run = await firstValueFrom(this.runsService.get(this.runId()));
      this.run.set(run);
      this.runError.set(null);
    } catch (err) {
      if (err instanceof ProblemDetailsError) this.runError.set(err);
    } finally {
      this.runLoading.set(false);
    }
  }

  async onCancelClick(): Promise<void> {
    const ok = await this.confirm.open({
      title: 'Cancel this run?',
      body: 'The run will stop and cannot be resumed.',
      confirmLabel: 'Cancel run',
      cancelLabel: 'Keep running',
      variant: 'danger',
    });
    if (!ok) return;
    this.cancelling.set(true);
    try {
      const updated = await firstValueFrom(this.runsService.cancel(this.runId()));
      // RunSummary is a subset of RunDetail — merge to preserve traceUri/budget/currentNode.
      const current = this.run();
      this.run.set(current ? { ...current, ...updated } : (updated as RunDetail));
    } catch (err) {
      if (err instanceof ProblemDetailsError && err.code === 'run-already-terminal') {
        this.toast.info('This run is already terminal.');
        await this.loadRun();
      } else if (err instanceof ProblemDetailsError) {
        this.toast.error(err.title);
      } else {
        this.toast.error('Could not cancel run.');
      }
    } finally {
      this.cancelling.set(false);
    }
  }

  reconnectStream(): void {
    if (this.runId()) this.traceStream.open(this.runId());
  }

  // Helpers used by the template's kind-distinguished render branches.
  stepStatusClass(status: StepStatus): string {
    if (status === 'dispatched' || status === 'in_progress') return 'bg-amber-100 text-amber-700';
    if (status === 'completed') return 'bg-emerald-100 text-emerald-700';
    if (status === 'failed') return 'bg-red-100 text-red-700';
    return 'bg-slate-100 text-slate-700';
  }
}
