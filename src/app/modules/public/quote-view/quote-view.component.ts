import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { QuotesService } from '../../../core/services/quotes.service';
import { PublicQuote } from '../../../core/models/quote.model';
import { SaleScheme } from '../../../core/models/order.model';
import { ImageLightboxComponent } from '../../../shared/components/image-lightbox/image-lightbox.component';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';

/** Cómo se le nombra al cliente cada condición de venta. */
const SCHEME_LABELS: Record<SaleScheme, string> = {
  cash: 'Contado',
  msi: '6 meses sin intereses',
  store_credit: 'Crédito en tienda',
  layaway: 'Apartado',
  wholesale: 'Mayoreo',
};

/**
 * Vista que abre el cliente desde el link de WhatsApp. Sin sesión, sin
 * layout de panel y SIN ACCIONES: el cliente lee su presupuesto y responde
 * por WhatsApp, que es donde ya está la conversación.
 *
 * Un 404 aquí puede significar "el token no existe" o "la cotización venció";
 * desde afuera no se distinguen a propósito, y el mensaje al cliente es el
 * mismo en ambos casos.
 */
@Component({
  selector: 'app-quote-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quote-view.component.html',
  styleUrl: './quote-view.component.scss',
  imports: [CurrencyPipe, DatePipe, ImageLightboxComponent, MediaUrlPipe],
})
export class QuoteViewComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private quotesService = inject(QuotesService);

  protected loading = signal(true);
  protected quote = signal<PublicQuote | null>(null);
  protected notFound = signal(false);

  /** Foto de producto abierta en grande; null = lightbox cerrado. */
  protected zoomedImage = signal<string | null>(null);

  protected schemeLabel(scheme: SaleScheme): string {
    return SCHEME_LABELS[scheme] ?? 'Contado';
  }

  ngOnInit(): void {
    const token = this.route.snapshot.paramMap.get('token');
    if (!token) {
      this.loading.set(false);
      this.notFound.set(true);
      return;
    }

    this.quotesService.getByToken(token).subscribe({
      next: (quote) => {
        this.quote.set(quote);
        this.loading.set(false);
      },
      error: () => {
        this.notFound.set(true);
        this.loading.set(false);
      },
    });
  }
}
