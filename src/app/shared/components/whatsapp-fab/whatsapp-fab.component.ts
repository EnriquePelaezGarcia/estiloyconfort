import { ChangeDetectionStrategy, Component } from '@angular/core';
import { environment } from '../../../../environments/environment';

/**
 * Botón flotante de WhatsApp de las vistas públicas. El número vive en
 * `environment` para que footer, carrito y este botón apunten siempre al mismo
 * lado si cambia.
 */
@Component({
  selector: 'app-whatsapp-fab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './whatsapp-fab.component.html',
  styleUrl: './whatsapp-fab.component.scss',
})
export class WhatsappFabComponent {
  protected readonly url = `https://wa.me/${environment.whatsappNumber}?text=${encodeURIComponent(
    'Hola, me gustaría más información sobre sus muebles.',
  )}`;
}
