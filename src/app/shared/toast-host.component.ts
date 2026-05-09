import { Component, inject } from '@angular/core';
import { ToastService } from './toast.service';

@Component({
  selector: 'app-toast-host',
  standalone: true,
  templateUrl: './toast-host.component.html',
  styles: [],
})
export class ToastHostComponent {
  private readonly svc = inject(ToastService);
  readonly toasts = this.svc.toasts;

  onDismiss(id: number): void {
    this.svc.dismiss(id);
  }
}
