import { Component, computed, input } from '@angular/core';
import type { RunStatus } from '../models';
import type { ExecutorCallState } from '../models';

export type BadgeStatus = RunStatus | ExecutorCallState | 'dispatched';

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
  // Trace executor-call states reuse the same component.
  dispatched: { bg: 'bg-amber-100', text: 'text-amber-700', label: 'Awaiting' },
  received: { bg: 'bg-sky-100', text: 'text-sky-700', label: 'Received' },
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
