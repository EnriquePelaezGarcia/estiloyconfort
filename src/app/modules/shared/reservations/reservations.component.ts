import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { AdminService } from '../../../core/services/admin.service';
import { NotificationService } from '../../../core/services/notification.service';
import { StockReservation, StockReservationReason, StockReservationStatus } from '../../../core/models/order.model';

const REASON_LABELS: Record<StockReservationReason, string> = {
  color_unico: 'Color único',
  pagada: 'Ya pagada',
  fecha_entrega: 'Entrega en fecha específica',
  otro: 'Otro',
};

/**
 * Pantalla "Reservas" (Docs/plan-reserva-de-piezas.md §7.4) — compartida
 * entre admin y vendedor (D2/D7): ambos ven y liberan CUALQUIER reserva.
 *
 * Solo lectura + liberar. No hay creación aquí a propósito (D4): toda
 * reserva de pieza nace del payload de crear/editar un pedido en el POS
 * (order-create) — nunca de una pantalla de inventario suelta.
 */
@Component({
  selector: 'app-reservations',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reservations.component.html',
  styleUrl: './reservations.component.scss',
  imports: [DatePipe, RouterLink],
})
export class ReservationsComponent implements OnInit {
  private adminService = inject(AdminService);
  private notification = inject(NotificationService);
  private router = inject(Router);

  /** Base del link al detalle del pedido de origen: distinto path para admin y vendedor. */
  protected orderDetailBase = computed(() =>
    this.router.url.startsWith('/admin') ? '/admin/pedidos' : '/vendedor/pedidos',
  );

  protected reservations = signal<StockReservation[]>([]);
  protected loading = signal(true);
  protected statusFilter = signal<StockReservationStatus | 'all'>('active');
  protected search = signal('');
  protected releasingId = signal<number | null>(null);

  protected filteredReservations = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) return this.reservations();
    return this.reservations().filter(
      (r) =>
        r.productName.toLowerCase().includes(term) ||
        (r.customerName?.toLowerCase().includes(term) ?? false) ||
        r.orderNumber.toLowerCase().includes(term),
    );
  });

  ngOnInit(): void {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    const status = this.statusFilter() === 'all' ? undefined : this.statusFilter();
    this.adminService.listReservations({ status }).subscribe({
      next: ({ data }) => {
        this.reservations.set(data);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudieron cargar las reservas');
      },
    });
  }

  protected onSearchInput(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  protected setStatusFilter(status: StockReservationStatus | 'all'): void {
    this.statusFilter.set(status);
    this.load();
  }

  protected reasonLabel(reason: StockReservationReason): string {
    return REASON_LABELS[reason] ?? reason;
  }

  /** D7: cualquier admin o vendedor libera cualquier reserva; el backend guarda released_by = quien la hizo. */
  protected release(reservation: StockReservation): void {
    if (!confirm(`¿Liberar la reserva de "${reservation.productName}"? Volverá a estar disponible para cualquier pedido.`)) {
      return;
    }
    this.releasingId.set(reservation.id);
    this.adminService.releaseReservation(reservation.id).subscribe({
      next: (res) => {
        this.releasingId.set(null);
        this.notification.success(res.message);
        this.load();
      },
      error: (err: { error?: { message?: string } }) => {
        this.releasingId.set(null);
        this.notification.error(err?.error?.message ?? 'No se pudo liberar la reserva');
      },
    });
  }
}
