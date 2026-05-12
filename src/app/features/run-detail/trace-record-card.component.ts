import { Component, computed, input, signal } from '@angular/core';
import type {
  OperatorSignalRecord,
  PolicyCallRecord,
  StepRecord,
  StepStatus,
  TraceRecord,
  WebhookEventRecord,
} from '../../models';

interface RowIcon {
  bg: string;
  text: string;
  glyph: string;
}

const STEP_ICON: RowIcon = { bg: 'bg-slate-100', text: 'text-slate-500', glyph: 'align_horizontal_left' };
const STEP_DONE_ICON: RowIcon = { bg: 'bg-emerald-100', text: 'text-emerald-600', glyph: 'check_circle' };
const STEP_FAILED_ICON: RowIcon = { bg: 'bg-red-100', text: 'text-red-600', glyph: 'error' };
const POLICY_ICON: RowIcon = { bg: 'bg-violet-100', text: 'text-violet-600', glyph: 'psychology' };
const WEBHOOK_ICON: RowIcon = { bg: 'bg-emerald-100', text: 'text-emerald-600', glyph: 'webhook' };
const SIGNAL_ICON: RowIcon = { bg: 'bg-sky-100', text: 'text-sky-600', glyph: 'bolt' };
const AWAITING_ICON: RowIcon = { bg: 'bg-amber-100', text: 'text-amber-600', glyph: 'play_circle' };

@Component({
  selector: 'app-trace-record-card',
  standalone: true,
  templateUrl: './trace-record-card.component.html',
  styles: [],
})
export class TraceRecordCardComponent {
  readonly record = input.required<TraceRecord>();
  readonly awaiting = input<boolean>(false);

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

  readonly icon = computed<RowIcon>(() => {
    if (this.awaiting()) return AWAITING_ICON;
    const r = this.record();
    switch (r.kind) {
      case 'step':
        if (r.data.status === 'completed') return STEP_DONE_ICON;
        if (r.data.status === 'failed') return STEP_FAILED_ICON;
        return STEP_ICON;
      case 'policy_call':
        return POLICY_ICON;
      case 'webhook_event':
        return WEBHOOK_ICON;
      case 'operator_signal':
        return SIGNAL_ICON;
    }
  });

  readonly stepDurationMs = computed<number | null>(() => {
    const s = this.asStep();
    if (!s) return null;
    const a = s.data.dispatchedAt;
    const b = s.data.completedAt;
    if (!a || !b) return null;
    const ms = Date.parse(b) - Date.parse(a);
    return Number.isFinite(ms) ? ms : null;
  });

  readonly timestamp = computed<string>(() => {
    const r = this.record();
    let iso: string | null = null;
    switch (r.kind) {
      case 'step':
        iso = r.data.completedAt ?? r.data.dispatchedAt;
        break;
      case 'policy_call':
        iso = r.data.createdAt;
        break;
      case 'webhook_event':
        iso = r.data.processedAt ?? r.data.receivedAt;
        break;
      case 'operator_signal':
        iso = r.data.receivedAt;
        break;
    }
    if (!iso) return '';
    // HH:MM:SS for compact timeline display; full ISO available in tooltip.
    const m = iso.match(/T(\d{2}:\d{2}:\d{2})/);
    return m ? m[1]! : iso;
  });

  toggleExpanded(): void {
    this.expanded.update((v) => !v);
  }

  stepStatusClass(status: StepStatus): string {
    if (status === 'completed') return 'text-emerald-600';
    if (status === 'failed') return 'text-red-600';
    if (status === 'dispatched' || status === 'in_progress') return 'text-amber-700';
    return 'text-slate-500';
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

  formatNumber(n: number): string {
    return n.toLocaleString('en-US');
  }

  isEmpty(value: Record<string, unknown> | null | undefined): boolean {
    return !value || Object.keys(value).length === 0;
  }
}
