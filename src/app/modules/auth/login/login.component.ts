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
  styleUrls: ['./login.component.scss', '../auth-extras.scss'],
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
        // Entró con una contraseña temporal que le dio un administrador: el
        // resto del sistema le responde 403 hasta que la cambie, así que se le
        // lleva directo ahí en vez de a su panel.
        if (res.user.mustChangePassword) {
          this.router.navigate(['/auth/cambiar-contrasena']);
          return;
        }
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
