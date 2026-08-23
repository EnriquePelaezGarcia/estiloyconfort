import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { environment } from '../../../../environments/environment';

/**
 * Página "Nosotros". Contenido estático (historia, valores, por qué
 * elegirnos) redactado como borrador — pendiente de que el negocio lo revise
 * y ajuste con datos propios.
 */
@Component({
  selector: 'app-about',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './about.component.html',
  styleUrl: './about.component.scss',
  imports: [RouterLink],
})
export class AboutComponent {
  protected readonly whatsappUrl = `https://wa.me/${environment.whatsappNumber}?text=${encodeURIComponent(
    'Hola, tengo una duda antes de comprar.',
  )}`;

  protected readonly values = [
    {
      icon: 'verified',
      title: 'Calidad que dura',
      text: 'Seleccionamos materiales resistentes y revisamos cada pieza antes de que salga del taller.',
    },
    {
      icon: 'palette',
      title: 'Diseño para tu espacio',
      text: 'Líneas actuales que se acomodan a espacios reales, no solo a fotos de catálogo.',
    },
    {
      icon: 'weekend',
      title: 'Confort de verdad',
      text: 'Cada mueble se piensa para el uso diario, no solo para verse bien el primer día.',
    },
    {
      icon: 'forum',
      title: 'Trato cercano',
      text: 'Te acompañamos por WhatsApp desde la primera pregunta hasta la entrega en tu casa.',
    },
  ];

  protected readonly reasons = [
    'Atención personalizada por WhatsApp, sin intermediarios.',
    'Piezas armadas y revisadas antes de salir a entrega.',
    'Servicio en Puebla y alrededores.',
    'Seguimiento de principio a fin de tu compra.',
  ];
}
