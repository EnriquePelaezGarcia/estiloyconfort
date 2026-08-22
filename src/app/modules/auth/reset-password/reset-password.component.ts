import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { passwordsMatch } from '../password-match.validator';

@Component({
  selector: 'app-reset-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reset-password.component.html',
  styleUrls: ['../login/login.component.scss', '../auth-extras.scss'],
  imports: [ReactiveFormsModule, RouterLink],
})
export class ResetPasswordComponent {
  protected authService = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private notification = inject(NotificationService);

  /**
   * El token del enlace del correo. Es la única credencial de esta pantalla:
   * por eso no se pide la contraseña anterior.
   */
  private token = this.route.snapshot.paramMap.get('token') ?? '';

  protected showPassword = signal(false);
  protected errorMessage = signal('');

  protected form = this.fb.group(
    {
      newPassword: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', Validators.required],
    },
    { validators: passwordsMatch },
  );

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.errorMessage.set('');

    this.authService
      .resetPassword({
        token: this.token,
        newPassword: this.form.getRawValue().newPassword ?? '',
      })
      .subscribe({
        next: (res) => {
          // No se inicia sesión a propósito: si el enlace lo abrió alguien
          // más, no se le regala la sesión. Hay que entrar con la nueva clave.
          this.notification.success(res.message);
          this.router.navigate(['/auth/login']);
        },
        error: (err: { error?: { message?: string } }) => {
          this.errorMessage.set(
            err?.error?.message ??
              'El enlace no es válido o ya venció. Solicita uno nuevo.',
          );
        },
      });
  }
}
