import { Injectable, signal } from '@angular/core';

export type ToastVariant = 'success' | 'info' | 'error';

export interface Toast {
  id: number;
  variant: ToastVariant;
  title: string;
  body?: string;
}

const AUTO_DISMISS_MS = 4000;
const DEDUPE_WINDOW_MS = 1000;
const MAX_DEDUPE_ENTRIES = 32;

@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly _toasts = signal<Toast[]>([]);
  readonly toasts = this._toasts.asReadonly();

  private nextId = 1;
  private readonly recent = new Map<string, number>();

  success(title: string, body?: string): void {
    this.enqueue('success', title, body);
  }

  info(title: string, body?: string): void {
    this.enqueue('info', title, body);
  }

  error(title: string, body?: string): void {
    this.enqueue('error', title, body);
  }

  dismiss(id: number): void {
    this._toasts.update((arr) => arr.filter((t) => t.id !== id));
  }

  private enqueue(variant: ToastVariant, title: string, body?: string): void {
    const key = `${variant}|${title}|${body ?? ''}`;
    const last = this.recent.get(key);
    const now = Date.now();
    if (last !== undefined && now - last < DEDUPE_WINDOW_MS) return;
    this.recent.set(key, now);
    if (this.recent.size > MAX_DEDUPE_ENTRIES) {
      const first = this.recent.keys().next().value;
      if (first !== undefined) this.recent.delete(first);
    }

    const toast: Toast = body !== undefined
      ? { id: this.nextId++, variant, title, body }
      : { id: this.nextId++, variant, title };
    this._toasts.update((arr) => [...arr, toast]);

    if (variant !== 'error') {
      setTimeout(() => this.dismiss(toast.id), AUTO_DISMISS_MS);
    }
  }
}
