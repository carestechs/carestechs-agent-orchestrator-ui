import { Component, signal } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-run-start',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './run-start.component.html',
  styles: [],
})
export class RunStartComponent {
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
}
