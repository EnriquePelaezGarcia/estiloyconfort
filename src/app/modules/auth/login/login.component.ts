import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { LoginRequest } from '../../../core/models/auth.model';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  imports: [ReactiveFormsModule, RouterLink],
})
export class LoginComponent {
  protected authService = inject(AuthService);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private notification = inject(NotificationService);

  protected showPassword = signal(false);
  protected errorMessage = signal('');

  protected form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.errorMessage.set('');

    this.authService.login(this.form.getRawValue() as LoginRequest).subscribe({
      next: (res) => {
        this.notification.success(`Bienvenido, ${res.user.fullName}`);
        this.router.navigate([this.authService.dashboardRoute()]);
      },
      error: (err: { error?: { message?: string } }) => {
        this.errorMessage.set(
          err?.error?.message ?? 'Credenciales incorrectas. Inténtalo de nuevo.',
        );
      },
    });
  }
}
