import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { Location } from '@angular/common';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
  type AbstractControl,
  type ValidationErrors,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { debounceTime, startWith } from 'rxjs';
import { AgentsService } from '../../core/agents.service';
import { RunsService } from '../../core/runs.service';
import { ProblemDetailsError } from '../../core/problem-details.error';
import { FullPageErrorComponent } from '../../shared/full-page-error.component';
import type { Agent, RunIntake, StartRunRequest, WorkItem } from '../../models';
import { intakeJsonValidator, maxStepsValidator, parseIntake } from './intake-json.validator';

export type IntakeMode = 'structured' | 'json';

// Common lifecycle-agent kinds. The string is open-ended on the wire, so this
// is just a UX-friendly default set; operators can type any value in JSON mode.
export const WORK_ITEM_KINDS: readonly string[] = ['FEAT', 'BUG', 'IMP', 'DOC', 'CHORE'] as const;

export type SubmitErrorScope = 'intake' | 'agent' | 'page';
export interface SubmitError {
  scope: SubmitErrorScope;
  title: string;
  detail?: string;
  code?: string;
}

function maxStepsCtrlValidator(ctrl: AbstractControl): ValidationErrors | null {
  const err = maxStepsValidator(ctrl.value as number | null | undefined);
  return err ? { maxSteps: err } : null;
}

@Component({
  selector: 'app-run-start',
  standalone: true,
  imports: [RouterLink, ReactiveFormsModule, FullPageErrorComponent],
  templateUrl: './run-start.component.html',
  styles: [],
})
export class RunStartComponent implements OnInit {
  private readonly agentsService = inject(AgentsService);
  private readonly runsService = inject(RunsService);
  private readonly fb = inject(FormBuilder);
  private readonly location = inject(Location);
  private readonly router = inject(Router);

  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly submitError = signal<SubmitError | null>(null);

  readonly agents = signal<Agent[]>([]);
  readonly agentsLoading = signal(true);
  readonly agentsError = signal<{ title: string; detail?: string; code?: string } | null>(null);

  readonly intakeMode = signal<IntakeMode>('structured');
  readonly workItemKinds = WORK_ITEM_KINDS;

  // The form has both structured controls and a JSON-mode control. Only the
  // active mode's controls participate in validity (see refreshIntakeValidity).
  readonly form = this.fb.group({
    agentRef: this.fb.nonNullable.control('', { validators: [Validators.required] }),
    workItemId: this.fb.nonNullable.control('', { validators: [Validators.required] }),
    workItemKind: this.fb.nonNullable.control(WORK_ITEM_KINDS[0]!, { validators: [Validators.required] }),
    workItemContent: this.fb.nonNullable.control('', { validators: [Validators.required] }),
    intakeJson: this.fb.nonNullable.control(''),
    maxSteps: this.fb.control<number | null>(null, { validators: [maxStepsCtrlValidator] }),
  });

  toggleIntakeMode(): void {
    const next: IntakeMode = this.intakeMode() === 'structured' ? 'json' : 'structured';
    // When entering JSON mode, pre-fill from the structured fields (if any)
    // so the operator has a working starting point. When leaving JSON mode,
    // try to round-trip any current JSON back into the structured fields.
    if (next === 'json') {
      const intake = this.buildStructuredIntake();
      this.form.controls.intakeJson.setValue(
        JSON.stringify(intake, null, 2),
        { emitEvent: false },
      );
    } else {
      const parsed = parseIntake(this.form.controls.intakeJson.value);
      if (parsed.valid && parsed.parsed) {
        const wi = (parsed.parsed as { workItem?: WorkItem }).workItem;
        if (wi) {
          this.form.patchValue(
            {
              workItemId: wi.id ?? '',
              workItemKind: wi.kind ?? WORK_ITEM_KINDS[0]!,
              workItemContent: wi.content ?? '',
            },
            { emitEvent: false },
          );
        }
      }
    }
    this.intakeMode.set(next);
    this.refreshIntakeValidity();
  }

  private refreshIntakeValidity(): void {
    const mode = this.intakeMode();
    if (mode === 'structured') {
      this.form.controls.workItemId.setValidators([Validators.required]);
      this.form.controls.workItemKind.setValidators([Validators.required]);
      this.form.controls.workItemContent.setValidators([Validators.required]);
      this.form.controls.intakeJson.setValidators([]);
    } else {
      this.form.controls.workItemId.setValidators([]);
      this.form.controls.workItemKind.setValidators([]);
      this.form.controls.workItemContent.setValidators([]);
      this.form.controls.intakeJson.setValidators([intakeJsonValidator]);
    }
    this.form.controls.workItemId.updateValueAndValidity({ emitEvent: false });
    this.form.controls.workItemKind.updateValueAndValidity({ emitEvent: false });
    this.form.controls.workItemContent.updateValueAndValidity({ emitEvent: false });
    this.form.controls.intakeJson.updateValueAndValidity({ emitEvent: false });
  }

  private buildStructuredIntake(): RunIntake {
    return {
      workItem: {
        id: this.form.controls.workItemId.value.trim(),
        kind: this.form.controls.workItemKind.value.trim(),
        content: this.form.controls.workItemContent.value,
      },
    };
  }

  // Debounced intake-JSON value for the inline parse-error message. Only
  // meaningful in JSON mode; in structured mode this signal is unused.
  // 200ms feels responsive without flickering on every keystroke.
  private readonly intakeJsonValueDebounced = toSignal(
    this.form.controls.intakeJson.valueChanges.pipe(
      startWith(this.form.controls.intakeJson.value),
      debounceTime(200),
    ),
    { initialValue: this.form.controls.intakeJson.value },
  );

  readonly intakeErrorMessage = computed<string | null>(() => {
    if (this.intakeMode() !== 'json') return null;
    const value = this.intakeJsonValueDebounced() ?? '';
    if (value.trim() === '') return null;
    const r = parseIntake(value);
    return r.valid ? null : (r.error ?? 'Invalid JSON');
  });

  // Bridge maxSteps value to a signal so the computed below stays reactive.
  // `form.controls.maxSteps.value` is a getter, not a signal; reading it
  // inside `computed()` does not establish a dependency.
  private readonly maxStepsValue = toSignal(
    this.form.controls.maxSteps.valueChanges.pipe(startWith(this.form.controls.maxSteps.value)),
    { initialValue: this.form.controls.maxSteps.value },
  );

  readonly maxStepsErrorMessage = computed<string | null>(() => {
    return maxStepsValidator(this.maxStepsValue() ?? null);
  });

  // formStatus tracked as a signal so submitDisabled stays reactive.
  private readonly formStatus = toSignal(
    this.form.statusChanges.pipe(startWith(this.form.status)),
    { initialValue: this.form.status },
  );

  readonly submitDisabled = computed<boolean>(() => {
    return (
      this.submitting() ||
      this.formStatus() !== 'VALID' ||
      this.agents().length === 0 ||
      this.agentsError() !== null
    );
  });

  ngOnInit(): void {
    this.loadAgents();
  }

  loadAgents(): void {
    this.agentsLoading.set(true);
    this.agentsError.set(null);
    this.agentsService.list().subscribe({
      next: (list) => {
        this.agents.set(list);
        this.agentsLoading.set(false);
      },
      error: (err: unknown) => {
        this.agentsLoading.set(false);
        if (err instanceof ProblemDetailsError) {
          const next: { title: string; detail?: string; code?: string } = { title: err.title };
          if (err.detail !== undefined) next.detail = err.detail;
          if (err.code !== undefined) next.code = err.code;
          this.agentsError.set(next);
        } else {
          this.agentsError.set({ title: 'Could not load agents' });
        }
      },
    });
  }

  retryLoadAgents = (): void => {
    this.loadAgents();
  };

  onFormat(): void {
    if (this.intakeMode() !== 'json') return;
    const raw = this.form.controls.intakeJson.value;
    const r = parseIntake(raw);
    if (r.valid && r.parsed) {
      this.form.controls.intakeJson.setValue(JSON.stringify(r.parsed, null, 2));
    }
    // No-op on invalid; the inline error already explains why.
  }

  onCancel(): void {
    // Use Location.back when there's a real history entry to return to;
    // fall back to /runs on deep-link entry.
    if (window.history.length > 1) {
      this.location.back();
    } else {
      void this.router.navigate(['/runs']);
    }
  }

  onSubmit(event: Event): void {
    event.preventDefault();
    if (this.submitDisabled()) return;

    let intake: RunIntake;
    if (this.intakeMode() === 'structured') {
      intake = this.buildStructuredIntake();
    } else {
      const parsed = parseIntake(this.form.controls.intakeJson.value);
      if (!parsed.valid || !parsed.parsed) return;
      intake = parsed.parsed as RunIntake;
    }

    const maxSteps = this.form.controls.maxSteps.value;
    const req: StartRunRequest = {
      agentRef: this.form.controls.agentRef.value,
      intake,
      // Omit `budget` entirely when blank — the orchestrator applies its
      // default. Sending `budget: { maxSteps: null }` is rejected upstream.
      ...(maxSteps !== null && maxSteps !== undefined ? { budget: { maxSteps } } : {}),
    };

    this.submitting.set(true);
    this.submitError.set(null);
    this.runsService.startRun(req).subscribe({
      next: (run) => {
        // Leave `submitting=true` through navigation so the button stays
        // disabled until the component is destroyed; prevents a stray
        // double-click during the route change. Reset only on a navigation
        // failure (rare; only on a guard mismatch).
        void this.router.navigate(['/runs', run.id]).then((ok) => {
          if (!ok) this.submitting.set(false);
        });
      },
      error: (err: unknown) => {
        this.submitting.set(false);
        this.submitError.set(this.mapError(err));
      },
    });
  }

  private mapError(err: unknown): SubmitError {
    if (err instanceof ProblemDetailsError) {
      const base: SubmitError = { scope: 'page', title: err.title };
      if (err.detail !== undefined) base.detail = err.detail;
      if (err.code !== undefined) base.code = err.code;
      if (err.code === 'invalid-intake') return { ...base, scope: 'intake' };
      if (err.code === 'agent-not-found') return { ...base, scope: 'agent' };
      return base; // upstream-unavailable, upstream-error, status 0, unknown.
    }
    return { scope: 'page', title: 'Unexpected error' };
  }

  retrySubmit = (): void => {
    this.onSubmit(new Event('submit'));
  };

  refreshAgentsAfterError(): void {
    this.submitError.set(null);
    this.loadAgents();
  }
}
