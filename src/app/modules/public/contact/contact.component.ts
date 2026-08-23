import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ContactService } from '../../../core/services/contact.service';
import { ContactRequest } from '../../../core/models/contact.model';
import { environment } from '../../../../environments/environment';

const STORE_ADDRESS = 'C. 106 Ote., Bosques Santa Anita, 72227 Heroica Puebla de Zaragoza, Pue.';

/**
 * Página "Contacto": datos de la tienda (dirección, teléfono, correo,
 * horario, redes) y un formulario que manda un correo real al negocio
 * (backend/src/controllers/contactController.js).
 */
@Component({
  selector: 'app-contact',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './contact.component.html',
  styleUrl: './contact.component.scss',
  imports: [ReactiveFormsModule],
})
export class ContactComponent {
  private fb = inject(FormBuilder);
  private contactService = inject(ContactService);
  private sanitizer = inject(DomSanitizer);

  protected readonly storeAddress = STORE_ADDRESS;
  protected readonly whatsappUrl = `https://wa.me/${environment.whatsappNumber}?text=${encodeURIComponent(
    'Hola, me gustaría más información sobre sus muebles.',
  )}`;
  protected readonly phoneDisplay = '+52 222 190 2631';
  protected readonly phoneHref = 'tel:+522221902631';
  protected readonly contactEmail = 'muebleria@estiloyconfortm.com';
  protected readonly facebookUrl = environment.social.facebook;

  // Embed público de Google Maps por dirección: no necesita API key porque no
  // es la API de JavaScript, es el iframe de resultados de búsqueda.
  protected readonly mapUrl = this.sanitizer.bypassSecurityTrustResourceUrl(
    `https://www.google.com/maps?q=${encodeURIComponent(STORE_ADDRESS)}&output=embed`,
  );

  protected readonly sent = signal(false);
  protected readonly sending = signal(false);
  protected readonly errorMessage = signal('');

  protected form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    email: ['', [Validators.required, Validators.email]],
    phone: [''],
    message: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(4000)]],
  });

  protected submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.errorMessage.set('');
    this.sending.set(true);

    const raw = this.form.getRawValue();
    const payload: ContactRequest = {
      name: raw.name!,
      email: raw.email!,
      message: raw.message!,
      ...(raw.phone ? { phone: raw.phone } : {}),
    };

    this.contactService.send(payload).subscribe({
      next: () => {
        this.sending.set(false);
        this.sent.set(true);
      },
      error: (err: { error?: { message?: string } }) => {
        this.sending.set(false);
        this.errorMessage.set(
          err?.error?.message ??
            'No pudimos enviar tu mensaje. Intenta de nuevo más tarde o escríbenos por WhatsApp.',
        );
      },
    });
  }
}
