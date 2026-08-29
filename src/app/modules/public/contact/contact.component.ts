import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { NgOptimizedImage } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ContactService } from '../../../core/services/contact.service';
import { ContactRequest } from '../../../core/models/contact.model';
import { PHONE_PATTERN, formatPhoneDigits } from '../../../core/utils/phone';
import { environment } from '../../../../environments/environment';
import { ReviewsBadgeComponent } from '../../../shared/components/reviews-badge/reviews-badge.component';

const STORE_ADDRESS = 'C. 106 Ote., Bosques Santa Anita, 72227 Heroica Puebla de Zaragoza, Pue.';
// Código oficial de "Compartir > Insertar un mapa" de Google Maps para la
// ficha real del negocio (no requiere API key). A diferencia de armar la URL
// a mano por dirección o coordenadas, este iframe trae el pin con el nombre
// "Mueblería Estilo y Confort" en una etiqueta, igual que al buscarlo en Maps.
const STORE_MAP_EMBED_URL =
  'https://www.google.com/maps/embed?pb=!1m14!1m8!1m3!1d3770.7210094930897!2d-98.1411427!3d19.0760002!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x85cfc19a6bfd2d85%3A0x94ab75e54c96d6ab!2sMuebler%C3%ADa%20Estilo%20y%20Confort!5e0!3m2!1ses-419!2smx!4v1787732737267!5m2!1ses-419!2smx';

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
  imports: [ReactiveFormsModule, ReviewsBadgeComponent, NgOptimizedImage],
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
  // Ficha completa del negocio en Google Maps: ahí se ven la fachada, más
  // fotos y las reseñas, cosas que el iframe embebido no muestra.
  protected readonly mapsPlaceUrl = 'https://maps.app.goo.gl/3VLKLazkPUczBKgi9';

  protected readonly mapUrl = this.sanitizer.bypassSecurityTrustResourceUrl(STORE_MAP_EMBED_URL);

  protected readonly sent = signal(false);
  protected readonly sending = signal(false);
  protected readonly errorMessage = signal('');

  protected form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(120)]],
    email: ['', [Validators.required, Validators.email]],
    // Opcional, pero si lo dejan tiene que ser un teléfono a 10 dígitos:
    // `Validators.pattern` da por válido el campo vacío.
    phone: ['', [Validators.pattern(PHONE_PATTERN)]],
    message: ['', [Validators.required, Validators.minLength(10), Validators.maxLength(4000)]],
  });

  /** Recorta a 10 dígitos y formatea "222 123 4567" mientras el visitante escribe. */
  protected onPhoneInput(event: Event): void {
    this.form.controls.phone.setValue(formatPhoneDigits((event.target as HTMLInputElement).value));
  }

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
