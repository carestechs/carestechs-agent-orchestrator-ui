import { Component, input } from '@angular/core';

@Component({
  selector: 'app-full-page-error',
  standalone: true,
  templateUrl: './full-page-error.component.html',
  styles: [],
})
export class FullPageErrorComponent {
  readonly title = input.required<string>();
  readonly detail = input<string | undefined>(undefined);
  readonly code = input<string | undefined>(undefined);
  readonly retry = input<(() => void) | undefined>(undefined);

  invokeRetry(): void {
    const fn = this.retry();
    fn?.();
  }
}
