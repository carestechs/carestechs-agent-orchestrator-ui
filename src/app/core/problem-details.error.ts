import type { ProblemCode, ProblemDetails } from '../models';

export class ProblemDetailsError extends Error {
  readonly status: number;
  readonly code: ProblemCode;
  readonly title: string;
  readonly detail?: string;
  readonly errors?: Record<string, string[]>;
  readonly raw: ProblemDetails;

  constructor(problem: ProblemDetails) {
    super(problem.title);
    this.name = 'ProblemDetailsError';
    this.status = problem.status;
    this.code = problem.code;
    this.title = problem.title;
    if (problem.detail !== undefined) this.detail = problem.detail;
    if (problem.errors !== undefined) this.errors = problem.errors;
    this.raw = problem;
  }

  static fromUnknown(status: number, body: unknown): ProblemDetailsError {
    if (isProblemDetails(body)) {
      return new ProblemDetailsError(body);
    }
    return new ProblemDetailsError({
      type: 'about:blank',
      title: 'Unexpected error',
      status,
      code: 'unknown',
    });
  }
}

function isProblemDetails(value: unknown): value is ProblemDetails {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r['title'] === 'string' &&
    typeof r['status'] === 'number' &&
    typeof r['code'] === 'string'
  );
}
