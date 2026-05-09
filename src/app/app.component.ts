import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ToastHostComponent } from './shared/toast-host.component';
import { ConfirmModalComponent } from './shared/confirm-modal.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ToastHostComponent, ConfirmModalComponent],
  templateUrl: './app.component.html',
  styles: [],
})
export class AppComponent {}
