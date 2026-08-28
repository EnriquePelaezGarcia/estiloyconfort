import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';
import { AuthService } from '../../../core/auth/auth.service';
import { NotificationService } from '../../../core/services/notification.service';
import { QuoteRequestsService } from '../../../core/services/quote-requests.service';
import { PublicQuoteRequest, QuoteRequestItem } from '../../../core/models/quote-request.model';

/**
 * Pantalla que el asesor abre desde el link de WhatsApp (/precotizacion/:token).
 * Muestra la canasta que armó el cliente y, si hay sesión de vendedor/admin,
 * un botón para entrar al builder de cotizaciones YA PRECARGADO — sin volver a
 * buscar los productos. Ver Docs/plan-precotizacion-carrito.md.
 *
 * Es una página autónoma (sin layout de panel), como la vista de cotización
 * del cliente: se abre desde fuera y el token de la URL es la credencial.
 */
@Component({
  selector: 'app-quote-request-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './quote-request-review.component.html',
  styleUrl: './quote-request-review.component.scss',
  imports: [CurrencyPipe, DatePipe, RouterLink, MediaUrlPipe],
})
export class QuoteRequestReviewComponent implements OnInit {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private auth = inject(AuthService);
  private notification = inject(NotificationService);
  private service = inject(QuoteRequestsService);

  private token = '';

  protected loading = signal(true);
  protected notFound = signal(false);
  protected request = signal<PublicQuoteRequest | null>(null);
  protected working = signal(false);

  /** Solo un vendedor o admin con sesión puede crear la cotización. */
  protected isStaff = computed(
    () => this.auth.isAuthenticated() && ['seller', 'admin'].includes(this.auth.userRole() ?? ''),
  );

  private get panelBase(): string {
    return this.auth.userRole() === 'admin' ? '/admin' : '/vendedor';
  }

  /** Link de login que regresa a esta misma pantalla. */
  protected get loginQueryParams(): Record<string, string> {
    return { redirect: `/precotizacion/${this.token}` };
  }

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') ?? '';
    if (!this.token) {
      this.loading.set(false);
      this.notFound.set(true);
      return;
    }
    this.service.getPublic(this.token).subscribe({
      next: (request) => {
        this.request.set(request);
        this.loading.set(false);
      },
      error: () => {
        this.notFound.set(true);
        this.loading.set(false);
      },
    });
  }

  /**
   * Link directo para contestarle al cliente (D7). El teléfono viene tal cual
   * lo escribió — puede traer espacios, guiones o basura —, así que se limpia
   * aquí y se antepone la lada de México, igual que en el resto del panel.
   * Devuelve null si no quedan dígitos suficientes para marcar.
   */
  protected whatsappUrl(phone: string | null): string | null {
    const digits = (phone ?? '').replace(/\D/g, '');
    return digits.length >= 10 ? `https://wa.me/52${digits.slice(-10)}` : null;
  }

  protected variantText(item: QuoteRequestItem): string {
    return Object.entries(item.variantSelections ?? {})
      .map(([k, v]) => `${k}: ${v}`)
      .join(' · ');
  }

  protected createQuote(): void {
    this.router.navigate([this.panelBase, 'cotizaciones', 'nueva'], {
      queryParams: { fromRequest: this.token },
    });
  }

  protected dismiss(): void {
    if (this.working()) return;
    this.working.set(true);
    this.service.dismiss(this.token).subscribe({
      next: () => {
        this.working.set(false);
        this.notification.success('Precotización descartada');
        const current = this.request();
        if (current) this.request.set({ ...current, status: 'dismissed' });
      },
      error: (err: { error?: { message?: string } }) => {
        this.working.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo descartar');
      },
    });
  }
}
