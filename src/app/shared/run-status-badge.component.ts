import { Component, computed, input } from '@angular/core';
import type { RunStatus, StepStatus } from '../models';

export type BadgeStatus = RunStatus | StepStatus;

interface BadgeStyle {
  bg: string;
  text: string;
  label: string;
}

const FALLBACK: BadgeStyle = { bg: 'bg-slate-200', text: 'text-slate-600', label: 'Unknown' };

const BADGE_STYLES: Record<string, BadgeStyle> = {
  // Per docs/ui-specification.md > Status Badge Mapping (authoritative).
  running: { bg: 'bg-sky-100', text: 'text-sky-700', label: 'Running' },
  paused: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Paused' },
  completed: { bg: 'bg-emerald-100', text: 'text-emerald-700', label: 'Completed' },
  failed: { bg: 'bg-red-100', text: 'text-red-700', label: 'Failed' },
  cancelled: { bg: 'bg-slate-200', text: 'text-slate-600', label: 'Cancelled' },
  // Step statuses reuse the same component.
  pending: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Pending' },
  dispatched: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Awaiting' },
  in_progress: { bg: 'bg-sky-100', text: 'text-sky-700', label: 'In progress' },
};

@Component({
  selector: 'app-run-status-badge',
  standalone: true,
  templateUrl: './run-status-badge.component.html',
  styles: [],
})
export class RunStatusBadgeComponent {
  readonly status = input.required<BadgeStatus>();
  readonly style = computed<BadgeStyle>(() => BADGE_STYLES[this.status()] ?? FALLBACK);
}
