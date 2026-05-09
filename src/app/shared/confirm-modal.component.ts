import { Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { ConfirmModalService } from './confirm-modal.service';

@Component({
  selector: 'app-confirm-modal',
  standalone: true,
  templateUrl: './confirm-modal.component.html',
  styles: [],
})
export class ConfirmModalComponent {
  private readonly svc = inject(ConfirmModalService);
  readonly state = this.svc.state;

  private readonly confirmBtn = viewChild<ElementRef<HTMLButtonElement>>('confirmBtn');
  private readonly rootEl = viewChild<ElementRef<HTMLDivElement>>('root');
  private previouslyFocused: HTMLElement | null = null;

  constructor() {
    effect(() => {
      const s = this.state();
      if (s) {
        this.previouslyFocused = (document.activeElement as HTMLElement | null) ?? null;
        queueMicrotask(() => this.confirmBtn()?.nativeElement.focus());
      } else if (this.previouslyFocused) {
        this.previouslyFocused.focus?.();
        this.previouslyFocused = null;
      }
    });
  }

  onConfirm(): void {
    this.svc.confirm();
  }

  onCancel(): void {
    this.svc.cancel();
  }

  onBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.onCancel();
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.onCancel();
      return;
    }
    if (event.key !== 'Tab') return;
    const root = this.rootEl()?.nativeElement;
    if (!root) return;
    const focusable = root.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}
