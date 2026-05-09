import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
}

interface ConfirmState {
  visible: boolean;
  opts: Required<ConfirmOptions>;
  resolver: (v: boolean) => void;
}

@Injectable({ providedIn: 'root' })
export class ConfirmModalService {
  private readonly _state = signal<ConfirmState | null>(null);
  readonly state = this._state.asReadonly();

  open(opts: ConfirmOptions): Promise<boolean> {
    if (this._state() !== null) {
      // v1: only one modal at a time. Resolve any open dialog as cancelled.
      this._state()!.resolver(false);
    }
    return new Promise<boolean>((resolve) => {
      this._state.set({
        visible: true,
        opts: {
          title: opts.title,
          body: opts.body ?? '',
          confirmLabel: opts.confirmLabel ?? 'Confirm',
          cancelLabel: opts.cancelLabel ?? 'Cancel',
          variant: opts.variant ?? 'danger',
        },
        resolver: resolve,
      });
    });
  }

  confirm(): void {
    const s = this._state();
    if (!s) return;
    this._state.set(null);
    s.resolver(true);
  }

  cancel(): void {
    const s = this._state();
    if (!s) return;
    this._state.set(null);
    s.resolver(false);
  }
}
