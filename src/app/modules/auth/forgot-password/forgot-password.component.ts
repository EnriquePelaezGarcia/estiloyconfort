import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';
import { ForgotPasswordRequest } from '../../../core/models/auth.model';

@Component({
  selector: 'app-forgot-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './forgot-password.component.html',
  // Comparte la hoja del login en vez de duplicar sus 340 líneas: las tres
  // pantallas de contraseña usan exactamente el mismo diseño de dos paneles.
  styleUrls: ['../login/login.component.scss', '../auth-extras.scss'],
  imports: [ReactiveFormsModule, RouterLink],
})
export class ForgotPasswordComponent {
  protected authService = inject(AuthService);
  private fb = inject(FormBuilder);

  /** Ya se envió la solicitud: se muestra la confirmación en vez del formulario. */
  protected sent = signal(false);
  protected confirmation = signal('');
  protected errorMessage = signal('');

  protected form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.errorMessage.set('');

    this.authService
      .forgotPassword(this.form.getRawValue() as ForgotPasswordRequest)
      .subscribe({
        next: (res) => {
          // El mensaje viene del backend y es deliberadamente ambiguo: no
          // revela si la cuenta existe. Se muestra tal cual, sin "adornarlo"
          // con un "te enviamos el correo" que sí lo revelaría.
          this.confirmation.set(res.message);
          this.sent.set(true);
        },
        error: (err: { error?: { message?: string } }) => {
          this.errorMessage.set(
            err?.error?.message ??
              'No pudimos procesar tu solicitud. Intenta de nuevo más tarde.',
          );
        },
      });
  }
}
