import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { forkJoin, Observable } from 'rxjs';
import { ManufacturerService } from '../../../core/services/manufacturer.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ManufacturerOrder } from '../../../core/models/order.model';
import { ManufacturerPurchaseOrder } from '../../../core/models/manufacturing.model';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';
import { ImageLightboxComponent } from '../../../shared/components/image-lightbox/image-lightbox.component';

/**
 * "Por fabricar" — vista unificada del portal del fabricante.
 *
 * Junta en una sola lista los pedidos de venta a fabricar (folio EC-) y las
 * órdenes de compra / encargos directos (folio OC-). Para el fabricante son lo
 * mismo: qué construir y para cuándo. Nunca ve la distinción; el componente
 * llama a los dos endpoints que ya existen, normaliza a `WorkOrder` y despacha
 * cada acción según `kind`.
 */
type WorkKind = 'sales' | 'purchase';

interface WorkItem {
  id: number;
  productName: string;
  productSku: string | null;
  imageUrl: string | null;
  materialLabel: string | null;
  sizeLabel: string | null;
  color: string | null;
  quantity: number;
  isReady: boolean;
  readyQuantity: number;
  /** Instrucción de modificación (pedido de venta). */
  fabricationNote: string | null;
  fabricationRefImages: string[];
  /** Especificaciones libres (orden de compra de producto nuevo). */
  specifications: string | null;
}

interface WorkOrder {
  kind: WorkKind;
  id: number;
  /** Folio tal cual (EC-…/OC-…); es lo único que el fabricante necesita ver. */
  ref: string;
  dueDate: string | null;
  notes: string | null;
  acceptance: { status: 'pending' | 'accepted' | 'rejected'; rejectReason: string | null };
  /** "Iniciar fabricación": solo pedidos de venta aún en 'pending'. */
  canStart: boolean;
  items: WorkItem[];
}

@Component({
  selector: 'app-manufacturer-orders',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manufacturer-orders.component.html',
  styleUrl: './manufacturer-orders.component.scss',
  imports: [DatePipe, MediaUrlPipe, ImageLightboxComponent],
})
export class ManufacturerOrdersComponent implements OnInit {
  private manufacturerService = inject(ManufacturerService);
  private notification = inject(NotificationService);

  protected orders = signal<WorkOrder[]>([]);
  protected loading = signal(true);

  /** Claves `kind:id` con una acción en curso. */
  protected working = signal<Set<string>>(new Set());
  /** Encargo cuyo modal de rechazo está abierto (null = cerrado). */
  protected rejectingOrder = signal<WorkOrder | null>(null);
  protected rejectReason = signal('');

  /** Foto del producto abierta a tamaño completo (ruta relativa, sin resolver). */
  protected zoomedImage = signal<string | null>(null);

  ngOnInit(): void {
    this.load();
  }

  private key(w: WorkOrder): string {
    return `${w.kind}:${w.id}`;
  }

  protected isWorking(w: WorkOrder): boolean {
    return this.working().has(this.key(w));
  }

  private setWorking(w: WorkOrder, on: boolean): void {
    this.working.update((s) => {
      const next = new Set(s);
      if (on) next.add(this.key(w)); else next.delete(this.key(w));
      return next;
    });
  }

  protected allReady(w: WorkOrder): boolean {
    return w.items.length > 0 && w.items.every((it) => it.isReady);
  }

  private load(): void {
    this.loading.set(true);
    forkJoin({
      sales: this.manufacturerService.getOrders(),
      purchase: this.manufacturerService.getPurchaseOrders(),
    }).subscribe({
      next: ({ sales, purchase }) => {
        const merged: WorkOrder[] = [
          ...sales.data.map((o) => this.fromSalesOrder(o)),
          ...purchase.data.map((po) => this.fromPurchaseOrder(po)),
        ].sort((a, b) => this.byDueThenRef(a, b));
        this.orders.set(merged);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudo cargar la lista');
      },
    });
  }

  private byDueThenRef(a: WorkOrder, b: WorkOrder): number {
    if (a.dueDate && b.dueDate) {
      return a.dueDate.localeCompare(b.dueDate) || a.ref.localeCompare(b.ref);
    }
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return a.ref.localeCompare(b.ref);
  }

  private fromSalesOrder(o: ManufacturerOrder): WorkOrder {
    return {
      kind: 'sales',
      id: o.id,
      ref: o.order_number,
      dueDate: o.manufacturer_due_date,
      notes: null,
      acceptance: {
        status: o.acceptance?.status ?? 'pending',
        rejectReason: o.acceptance?.rejectReason ?? null,
      },
      canStart: o.order_status === 'pending',
      items: o.items.map((it) => ({
        id: it.id,
        productName: it.productName,
        productSku: it.productSku ?? null,
        imageUrl: it.imageUrl ?? null,
        materialLabel: it.materialLabel ?? null,
        sizeLabel: it.sizeLabel ?? null,
        color: it.color ?? null,
        quantity: it.quantity,
        isReady: it.isReady,
        readyQuantity: it.readyQuantity ?? 0,
        fabricationNote: it.isCustomModification || it.fabricationNote ? (it.fabricationNote ?? null) : null,
        fabricationRefImages: it.fabricationRefImages ?? [],
        specifications: null,
      })),
    };
  }

  private fromPurchaseOrder(po: ManufacturerPurchaseOrder): WorkOrder {
    return {
      kind: 'purchase',
      id: po.id,
      ref: po.poNumber,
      dueDate: po.expectedDate,
      notes: po.notes,
      acceptance: {
        status: po.acceptance.status,
        rejectReason: po.acceptance.rejectReason,
      },
      canStart: false,
      items: po.items.map((it) => ({
        id: it.id,
        productName: it.productName,
        productSku: it.productSku ?? null,
        imageUrl: it.imageUrl,
        materialLabel: it.materialLabel,
        sizeLabel: it.sizeLabel,
        color: it.color,
        quantity: it.quantity,
        isReady: it.isReady,
        readyQuantity: it.readyQuantity,
        fabricationNote: null,
        fabricationRefImages: [],
        specifications: it.specifications,
      })),
    };
  }

  // ── Aceptación del encargo ──────────────────────────────────────────────
  protected acceptOrder(w: WorkOrder): void {
    this.setWorking(w, true);
    const req = w.kind === 'sales'
      ? this.manufacturerService.acceptOrder(w.id)
      : this.manufacturerService.acceptPurchaseOrder(w.id);
    req.subscribe({
      next: (res: { message?: string }) => {
        this.setWorking(w, false);
        this.notification.success(res?.message ?? 'Encargo aceptado');
        this.load();
      },
      error: (err: { error?: { message?: string } }) => {
        this.setWorking(w, false);
        this.notification.error(err?.error?.message ?? 'No se pudo aceptar');
      },
    });
  }

  protected openReject(w: WorkOrder): void {
    this.rejectingOrder.set(w);
    this.rejectReason.set('');
  }

  protected closeReject(): void {
    this.rejectingOrder.set(null);
  }

  protected submitReject(): void {
    const w = this.rejectingOrder();
    const reason = this.rejectReason().trim();
    if (!w) return;
    if (!reason) {
      this.notification.error('Escribe el motivo del rechazo');
      return;
    }
    this.setWorking(w, true);
    const req = w.kind === 'sales'
      ? this.manufacturerService.rejectOrder(w.id, reason)
      : this.manufacturerService.rejectPurchaseOrder(w.id, reason);
    req.subscribe({
      next: (res: { message?: string }) => {
        this.setWorking(w, false);
        this.closeReject();
        this.notification.success(res?.message ?? 'Encargo rechazado');
        this.load();
      },
      error: (err: { error?: { message?: string } }) => {
        this.setWorking(w, false);
        this.notification.error(err?.error?.message ?? 'No se pudo rechazar');
      },
    });
  }

  // ── Avance por producto ─────────────────────────────────────────────────
  protected toggleItem(w: WorkOrder, itemId: number, isReady: boolean): void {
    const req: Observable<unknown> = w.kind === 'sales'
      ? this.manufacturerService.markItemReady(w.id, itemId, isReady)
      : this.manufacturerService.markPurchaseOrderItemReady(w.id, itemId, isReady);
    req.subscribe({
      next: () => this.load(),
      error: () => this.notification.error('No se pudo actualizar el producto'),
    });
  }

  protected setReadyQuantity(w: WorkOrder, itemId: number, value: string): void {
    const qty = Math.max(0, Math.trunc(Number(value) || 0));
    const item = w.items.find((it) => it.id === itemId);
    if (!item || qty > item.quantity) return;
    const done = qty >= item.quantity;
    const req: Observable<unknown> = w.kind === 'sales'
      ? this.manufacturerService.markItemReady(w.id, itemId, done, qty)
      : this.manufacturerService.markPurchaseOrderItemReady(w.id, itemId, done, qty);
    req.subscribe({
      next: () => this.load(),
      error: () => this.notification.error('No se pudo actualizar el producto'),
    });
  }

  protected startFabrication(w: WorkOrder): void {
    if (w.kind !== 'sales') return;
    this.manufacturerService.startFabrication(w.id).subscribe({
      next: () => {
        this.notification.success('Marcado en fabricación');
        this.load();
      },
      error: (err: { error?: { message?: string } }) =>
        this.notification.error(err?.error?.message ?? 'No se pudo actualizar'),
    });
  }
}
