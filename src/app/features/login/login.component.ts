import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { ProblemDetailsError } from '../../core/problem-details.error';
import { safeRedirectTarget } from './safe-redirect';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './login.component.html',
  styles: [],
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly passphrase = signal('');
  readonly submitting = signal(false);
  readonly errorCode = signal<string | null>(null);
  readonly errorMessage = signal<string | null>(null);

  readonly expiredBanner = computed(
    () => this.route.snapshot.queryParamMap.get('reason') === 'expired',
  );
  readonly redirectTarget = computed(() =>
    safeRedirectTarget(this.route.snapshot.queryParamMap.get('redirect')),
  );

  async submit(): Promise<void> {
    if (this.submitting()) return;
    const value = this.passphrase();
    if (!value) return;

    this.errorCode.set(null);
    this.errorMessage.set(null);
    this.submitting.set(true);
    try {
      await firstValueFrom(this.auth.login(value));
      await this.router.navigateByUrl(this.redirectTarget());
    } catch (err) {
      if (err instanceof ProblemDetailsError && err.code === 'invalid-passphrase') {
        this.errorCode.set('invalid-passphrase');
        this.errorMessage.set('Incorrect passphrase.');
      } else {
        this.errorMessage.set("Couldn't reach the server. Try again.");
      }
    } finally {
      this.submitting.set(false);
    }
  }
}
