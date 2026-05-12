import { Component, computed, input, signal } from '@angular/core';
import type {
  OperatorSignalRecord,
  PolicyCallRecord,
  StepRecord,
  StepStatus,
  TraceRecord,
  WebhookEventRecord,
} from '../../models';

@Component({
  selector: 'app-trace-record-card',
  standalone: true,
  templateUrl: './trace-record-card.component.html',
  styles: [],
})
export class TraceRecordCardComponent {
  readonly record = input.required<TraceRecord>();

  readonly expanded = signal<boolean>(false);

  readonly asStep = computed<StepRecord | null>(() =>
    this.record().kind === 'step' ? (this.record() as StepRecord) : null,
  );
  readonly asPolicy = computed<PolicyCallRecord | null>(() =>
    this.record().kind === 'policy_call' ? (this.record() as PolicyCallRecord) : null,
  );
  readonly asWebhook = computed<WebhookEventRecord | null>(() =>
    this.record().kind === 'webhook_event' ? (this.record() as WebhookEventRecord) : null,
  );
  readonly asSignal = computed<OperatorSignalRecord | null>(() =>
    this.record().kind === 'operator_signal' ? (this.record() as OperatorSignalRecord) : null,
  );

  readonly stepDurationMs = computed<number | null>(() => {
    const s = this.asStep();
    if (!s) return null;
    const a = s.data.dispatchedAt;
    const b = s.data.completedAt;
    if (!a || !b) return null;
    const ms = Date.parse(b) - Date.parse(a);
    return Number.isFinite(ms) ? ms : null;
  });

  toggleExpanded(): void {
    this.expanded.update((v) => !v);
  }

  stepStatusClass(status: StepStatus): string {
    if (status === 'dispatched' || status === 'in_progress') return 'bg-amber-100 text-amber-700';
    if (status === 'completed') return 'bg-emerald-100 text-emerald-700';
    if (status === 'failed') return 'bg-red-100 text-red-700';
    return 'bg-slate-100 text-slate-700';
  }

  formatJson(value: unknown): string {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }

  formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const s = ms / 1000;
    if (s < 60) return `${s.toFixed(1)}s`;
    const m = Math.floor(s / 60);
    const r = Math.round(s - m * 60);
    return `${m}m ${r}s`;
  }

  isEmpty(value: Record<string, unknown> | null | undefined): boolean {
    return !value || Object.keys(value).length === 0;
  }
}
