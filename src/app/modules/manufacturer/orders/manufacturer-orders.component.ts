import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { forkJoin, Observable } from 'rxjs';
import { ManufacturerService } from '../../../core/services/manufacturer.service';
import { NotificationService } from '../../../core/services/notification.service';
import { ManufacturerOrder } from '../../../core/models/order.model';
import {
  ManufacturerChargeRequest,
  ManufacturerPurchaseOrder,
} from '../../../core/models/manufacturing.model';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';
import { ImageLightboxComponent } from '../../../shared/components/image-lightbox/image-lightbox.component';
import { ItemMessagesComponent } from '../../../shared/components/item-messages/item-messages.component';

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
  /** Costo del encargo — solo en órdenes de compra (folio OC-). null en pedidos de venta. */
  totalCost: number | null;
  /** Ajustes de precio que este fabricante pidió sobre el encargo (Fase B). */
  charges: ManufacturerChargeRequest[];
  items: WorkItem[];
}

@Component({
  selector: 'app-manufacturer-orders',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './manufacturer-orders.component.html',
  styleUrl: './manufacturer-orders.component.scss',
  imports: [CurrencyPipe, DatePipe, MediaUrlPipe, ImageLightboxComponent, ItemMessagesComponent],
})
export class ManufacturerOrdersComponent implements OnInit {
  private manufacturerService = inject(ManufacturerService);
  private notification = inject(NotificationService);
  private route = inject(ActivatedRoute);
  private destroyRef = inject(DestroyRef);

  /** Item al que apunta la notificación con la que se llegó (link "Mensajes"). */
  protected focusItemId = signal<number | null>(null);

  protected orders = signal<WorkOrder[]>([]);
  protected loading = signal(true);

  /** Claves `kind:id` con una acción en curso. */
  protected working = signal<Set<string>>(new Set());
  /** Encargo cuyo modal de rechazo está abierto (null = cerrado). */
  protected rejectingOrder = signal<WorkOrder | null>(null);
  protected rejectReason = signal('');

  /** Foto del producto abierta a tamaño completo (ruta relativa, sin resolver). */
  protected zoomedImage = signal<string | null>(null);

  /** Ids de item cuya foto no cargó: se oculta el recuadro en vez de dejarlo vacío. */
  protected brokenImages = signal<Set<number>>(new Set());

  protected markImageBroken(itemId: number): void {
    this.brokenImages.update((s) => new Set(s).add(itemId));
  }

  // ── Modal "Solicitar ajuste de precio" (Fase B) ────────────────────────────
  protected chargeTarget = signal<WorkOrder | null>(null);
  /** id de la solicitud en edición (null = nueva). */
  protected chargeEditingId = signal<number | null>(null);
  protected chargeAmount = signal('');
  protected chargeConcept = signal('');
  protected chargeNotes = signal('');
  protected savingCharge = signal(false);
  /**
   * Precio actual del encargo (referencia) + lo que quedaría si se aprueba el
   * ajuste. Solo existe en órdenes de compra: los pedidos de venta no le
   * muestran precio al fabricante (D14).
   */
  protected chargeCurrentTotal = computed(() => this.chargeTarget()?.totalCost ?? null);
  protected chargeNewTotal = computed(() => {
    const current = this.chargeCurrentTotal();
    if (current === null) return null;
    return current + (Number(this.chargeAmount()) || 0);
  });

  ngOnInit(): void {
    // El link "Mensajes" de una notificación apunta a esta misma ruta con solo
    // el query param distinto: si ya estabas en /fabricante/pedidos, Angular
    // reutiliza el componente y ngOnInit no vuelve a correr. Suscribirse al
    // observable (en vez de leer solo el snapshot) hace que el segundo click
    // también aterrice y abra el hilo, no solo la primera navegación.
    this.route.queryParamMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const raw = params.get('item');
      this.focusItemId.set(raw ? Number(raw) : null);
      if (!this.loading()) this.scrollToFocusedItem();
    });
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
      charges: this.manufacturerService.getChargeRequests(),
    }).subscribe({
      next: ({ sales, purchase, charges }) => {
        const chargesFor = (kind: WorkKind, id: number) => charges.data.filter(
          (c) => c.sourceId === id
            && c.sourceType === (kind === 'sales' ? 'order' : 'purchase_order'),
        );
        const merged: WorkOrder[] = [
          ...sales.data.map((o) => {
            const w = this.fromSalesOrder(o);
            w.charges = chargesFor('sales', o.id);
            return w;
          }),
          ...purchase.data.map((po) => {
            const w = this.fromPurchaseOrder(po);
            w.charges = chargesFor('purchase', po.id);
            return w;
          }),
        ].sort((a, b) => this.byDueThenRef(a, b));
        this.orders.set(merged);
        this.loading.set(false);
        this.scrollToFocusedItem();
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
      totalCost: null,
      charges: [],
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
      totalCost: po.totalCost ?? null,
      charges: [],
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

  // ── Solicitar ajuste de precio (Fase B) ─────────────────────────────────────
  protected openCharge(w: WorkOrder): void {
    this.chargeTarget.set(w);
    this.chargeEditingId.set(null);
    this.chargeAmount.set('');
    this.chargeConcept.set('');
    this.chargeNotes.set('');
  }

  protected openEditCharge(w: WorkOrder, c: ManufacturerChargeRequest): void {
    this.chargeTarget.set(w);
    this.chargeEditingId.set(c.id);
    this.chargeAmount.set(String(c.amount));
    this.chargeConcept.set(c.concept);
    this.chargeNotes.set(c.notes ?? '');
  }

  protected closeCharge(): void {
    this.chargeTarget.set(null);
  }

  protected submitCharge(): void {
    const w = this.chargeTarget();
    if (!w) return;
    const amount = Math.round((Number(this.chargeAmount()) || 0) * 100) / 100;
    const concept = this.chargeConcept().trim();
    if (!(amount > 0)) { this.notification.error('El monto debe ser mayor a 0'); return; }
    if (!concept) { this.notification.error('Escribe el motivo del ajuste'); return; }
    const notes = this.chargeNotes().trim() || null;
    this.savingCharge.set(true);

    const editingId = this.chargeEditingId();
    const req: Observable<{ message?: string }> = editingId != null
      ? this.manufacturerService.updateChargeRequest(editingId, { amount, concept, notes })
      : (w.kind === 'sales'
        ? this.manufacturerService.requestOrderCharge(w.id, { amount, concept, notes })
        : this.manufacturerService.requestPurchaseOrderCharge(w.id, { amount, concept, notes }));

    req.subscribe({
      next: (res) => {
        this.savingCharge.set(false);
        this.closeCharge();
        this.notification.success(res?.message ?? 'Solicitud enviada');
        this.load();
      },
      error: (err: { error?: { message?: string } }) => {
        this.savingCharge.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo enviar la solicitud');
      },
    });
  }

  protected cancelCharge(c: ManufacturerChargeRequest): void {
    this.manufacturerService.cancelChargeRequest(c.id).subscribe({
      next: () => { this.notification.success('Solicitud cancelada'); this.load(); },
      error: (err: { error?: { message?: string } }) =>
        this.notification.error(err?.error?.message ?? 'No se pudo cancelar'),
    });
  }

  protected ackCharge(c: ManufacturerChargeRequest): void {
    this.manufacturerService.acknowledgeChargeRejection(c.id).subscribe({
      next: () => this.load(),
      error: () => {},
    });
  }

  protected chargeStatusLabel(s: ManufacturerChargeRequest['status']): string {
    return s === 'approved' ? 'Aprobado' : s === 'rejected' ? 'Rechazado' : 'Pendiente';
  }

  protected chargeStatusTone(s: ManufacturerChargeRequest['status']): string {
    return s === 'approved' ? 'badge--green' : s === 'rejected' ? 'badge--red' : 'badge--amber';
  }

  /** Aterriza sobre el producto de la notificación (link "Mensajes"), ya con el hilo abierto. */
  private scrollToFocusedItem(): void {
    const id = this.focusItemId();
    if (!id) return;
    setTimeout(() => {
      document.getElementById(`item-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 50);
  }
}
