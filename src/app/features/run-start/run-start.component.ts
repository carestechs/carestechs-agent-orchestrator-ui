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
import { ProblemDetailsError } from '../../core/problem-details.error';
import { FullPageErrorComponent } from '../../shared/full-page-error.component';
import type { Agent } from '../../models';
import { intakeJsonValidator, maxStepsValidator, parseIntake } from './intake-json.validator';

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
  private readonly fb = inject(FormBuilder);
  private readonly location = inject(Location);
  private readonly router = inject(Router);

  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);

  readonly agents = signal<Agent[]>([]);
  readonly agentsLoading = signal(true);
  readonly agentsError = signal<{ title: string; detail?: string; code?: string } | null>(null);

  readonly form = this.fb.group({
    agentRef: this.fb.nonNullable.control('', { validators: [Validators.required] }),
    intake: this.fb.nonNullable.control('', { validators: [intakeJsonValidator] }),
    maxSteps: this.fb.control<number | null>(null, { validators: [maxStepsCtrlValidator] }),
  });

  // Debounced intake value for the inline parse-error message. 200ms feels
  // responsive without flickering on every keystroke. The form's underlying
  // validity (which gates the submit button) is NOT debounced — that runs
  // synchronously per keystroke through `intakeJsonValidator`.
  private readonly intakeValueDebounced = toSignal(
    this.form.controls.intake.valueChanges.pipe(
      startWith(this.form.controls.intake.value),
      debounceTime(200),
    ),
    { initialValue: this.form.controls.intake.value },
  );

  readonly intakeErrorMessage = computed<string | null>(() => {
    const value = this.intakeValueDebounced() ?? '';
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
    const raw = this.form.controls.intake.value;
    const r = parseIntake(raw);
    if (r.valid && r.parsed) {
      this.form.controls.intake.setValue(JSON.stringify(r.parsed, null, 2));
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
    // T-026 will implement.
  }
}
