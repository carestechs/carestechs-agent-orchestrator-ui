import type { ValidatorFn } from '@angular/forms';

export interface IntakeJsonResult {
  valid: boolean;
  parsed?: Record<string, unknown>;
  error?: string;
}

export function parseIntake(raw: string): IntakeJsonResult {
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return { valid: false, error: 'Intake is required.' };
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { valid: false, error: 'Intake must be a JSON object.' };
    }
    return { valid: true, parsed: parsed as Record<string, unknown> };
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
}

export const intakeJsonValidator: ValidatorFn = (ctrl) => {
  const value = typeof ctrl.value === 'string' ? ctrl.value : '';
  const r = parseIntake(value);
  return r.valid ? null : { intakeJson: r.error ?? 'Invalid JSON' };
};

export function maxStepsValidator(value: number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 1) {
    return 'Max steps must be a positive integer.';
  }
  return null;
}
