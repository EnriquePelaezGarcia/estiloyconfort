import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { passwordsMatch } from '../password-match.validator';

@Component({
  selector: 'app-change-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './change-password.component.html',
  styleUrls: ['../login/login.component.scss', '../auth-extras.scss'],
  imports: [ReactiveFormsModule, RouterLink],
})
export class ChangePasswordComponent {
  protected authService = inject(AuthService);
  private router = inject(Router);
  private fb = inject(FormBuilder);
  private notification = inject(NotificationService);

  /**
   * El usuario llegó aquí porque un administrador le generó una contraseña
   * temporal, no porque quisiera. En ese caso no se le ofrece salida: el resto
   * del sistema le responde 403 hasta que cambie la contraseña.
   */
  protected readonly forced = computed(() => this.authService.mustChangePassword());

  protected showPassword = signal(false);
  protected errorMessage = signal('');

  protected form = this.fb.group(
    {
      currentPassword: ['', Validators.required],
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

    const { currentPassword, newPassword } = this.form.getRawValue();

    this.authService
      .changePassword({
        currentPassword: currentPassword ?? '',
        newPassword: newPassword ?? '',
      })
      .subscribe({
        next: () => {
          this.notification.success('Tu contraseña se actualizó correctamente');
          // El backend ya devolvió tokens nuevos sin la bandera, así que
          // dashboardRoute() lleva al panel que le toca por su rol.
          this.router.navigate([this.authService.dashboardRoute()]);
        },
        error: (err: { error?: { message?: string } }) => {
          this.errorMessage.set(
            err?.error?.message ?? 'No pudimos cambiar tu contraseña. Intenta de nuevo.',
          );
        },
      });
  }
}
