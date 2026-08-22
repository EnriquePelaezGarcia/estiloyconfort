import { AbstractControl, ValidationErrors } from '@angular/forms';

/**
 * Valida a nivel de grupo que `newPassword` y `confirmPassword` coincidan.
 *
 * Se aplica al grupo y no al campo porque la regla depende de dos controles.
 * El error se marca también en `confirmPassword` para poder pintarlo debajo de
 * ese campo, que es donde el usuario espera verlo.
 */
export function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const password = group.get('newPassword');
  const confirmation = group.get('confirmPassword');
  if (!password || !confirmation) return null;

  // Mientras el usuario no haya escrito la confirmación no se marca error:
  // avisar de "no coinciden" en la primera tecla es ruido.
  if (!confirmation.value) return null;

  if (password.value === confirmation.value) {
    // Se limpia solo este error para no borrar los que ponga otro validador.
    const errors = { ...(confirmation.errors ?? {}) };
    delete errors['passwordsMismatch'];
    confirmation.setErrors(Object.keys(errors).length ? errors : null);
    return null;
  }

  confirmation.setErrors({ ...(confirmation.errors ?? {}), passwordsMismatch: true });
  return { passwordsMismatch: true };
}
