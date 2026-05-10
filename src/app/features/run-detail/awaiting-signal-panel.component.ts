import {
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { SignalsService } from '../../core/signals.service';
import { ToastService } from '../../shared/toast.service';
import { ProblemDetailsError } from '../../core/problem-details.error';
import type {
  ExecutorCallRecord,
  RunStatus,
  SignalPayload,
  SignalRequest,
  TraceRecord,
} from '../../models';

const COMMIT_SHA_PATTERN = /^[0-9a-fA-F]{7,40}$/;
const HTTPS_URL_PATTERN = /^https:\/\/.+/i;

@Component({
  selector: 'app-awaiting-signal-panel',
  standalone: true,
  imports: [ReactiveFormsModule],
  templateUrl: './awaiting-signal-panel.component.html',
  styles: [],
})
export class AwaitingSignalPanelComponent {
  private readonly signalsService = inject(SignalsService);
  private readonly toast = inject(ToastService);

  readonly runId = input.required<string>();
  readonly traceRecords = input.required<TraceRecord[]>();
  readonly runStatus = input.required<RunStatus>();

  readonly runRefreshRequested = output<void>();

  readonly form = new FormGroup({
    taskId: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
    commitSha: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(COMMIT_SHA_PATTERN)],
    }),
    prUrl: new FormControl<string>('', {
      nonNullable: true,
      validators: [Validators.required, Validators.pattern(HTTPS_URL_PATTERN)],
    }),
    diff: new FormControl<string>('', { nonNullable: true }),
    implementationNotes: new FormControl<string>('', { nonNullable: true }),
  });

  readonly submitting = signal<boolean>(false);
  readonly fieldErrors = signal<Record<string, string[]>>({});
  readonly taskIdError = signal<string | null>(null);

  readonly awaitingDispatches = computed<ExecutorCallRecord[]>(() => {
    const records = this.traceRecords();
    return records.filter(
      (r): r is ExecutorCallRecord =>
        r.kind === 'executor_call' && r.state === 'dispatched' && r.mode === 'human',
    );
  });

  readonly latestDispatch = computed<ExecutorCallRecord | null>(() => {
    const list = this.awaitingDispatches();
    if (list.length === 0) return null;
    return [...list].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))[0]!;
  });

  readonly prefilledTaskIds = computed<string[]>(() => {
    const ids = new Set<string>();
    for (const r of this.awaitingDispatches()) {
      if (typeof r.taskId === 'string' && r.taskId.length > 0) {
        ids.add(r.taskId);
        continue;
      }
      const intake = r.intake;
      if (intake && typeof intake === 'object') {
        const candidate = (intake as Record<string, unknown>)['taskId'];
        if (typeof candidate === 'string' && candidate.length > 0) ids.add(candidate);
      }
    }
    return [...ids];
  });

  readonly formVisible = computed(
    () => this.runStatus() === 'paused' && this.latestDispatch() !== null,
  );

  readonly taskIdMode = computed<'single' | 'picker'>(() =>
    this.prefilledTaskIds().length > 1 ? 'picker' : 'single',
  );

  constructor() {
    effect(() => {
      const ids = this.prefilledTaskIds();
      const mode = this.taskIdMode();
      const ctrl = this.form.controls.taskId;
      if (ids.length === 0) {
        ctrl.reset('');
        ctrl.disable({ emitEvent: false });
        return;
      }
      if (mode === 'single') {
        ctrl.setValue(ids[0]!, { emitEvent: false });
        ctrl.disable({ emitEvent: false });
      } else {
        if (!ids.includes(ctrl.value)) ctrl.setValue(ids[0]!, { emitEvent: false });
        ctrl.enable({ emitEvent: false });
      }
    });
  }

  async onSubmit(): Promise<void> {
    if (this.submitting()) return;
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.fieldErrors.set({});
    this.taskIdError.set(null);

    const raw = this.form.getRawValue();
    const payload: SignalPayload = { commitSha: raw.commitSha, prUrl: raw.prUrl };
    if (raw.diff) payload['diff'] = raw.diff;
    if (raw.implementationNotes) payload['implementationNotes'] = raw.implementationNotes;
    const body: SignalRequest = {
      name: 'implementation-complete',
      taskId: raw.taskId,
      payload,
    };

    try {
      const result = await firstValueFrom(this.signalsService.submit(this.runId(), body));
      this.toast.success(result.alreadyReceived ? 'Signal already received' : 'Signal received');
      this.form.patchValue({ commitSha: '', prUrl: '', diff: '', implementationNotes: '' });
      this.form.controls.commitSha.markAsPristine();
      this.form.controls.prUrl.markAsPristine();
    } catch (err) {
      if (err instanceof ProblemDetailsError) {
        switch (err.code) {
          case 'task-not-in-run-memory':
            this.taskIdError.set(
              'This task is no longer awaiting a signal — re-pick from the trace.',
            );
            break;
          case 'invalid-signal-payload':
            this.fieldErrors.set(err.errors ?? { _form: [err.detail ?? err.title] });
            break;
          case 'run-already-terminal':
            this.toast.info('This run is already terminal.');
            this.runRefreshRequested.emit();
            break;
          default:
            this.toast.error(err.title);
        }
      } else {
        this.toast.error('Could not submit signal. Try again.');
      }
    } finally {
      this.submitting.set(false);
    }
  }
}
