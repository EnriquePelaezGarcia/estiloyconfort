import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { DeliveryService } from '../../../core/services/delivery.service';
import { TicketsService } from '../../../core/services/tickets.service';
import { NotificationService } from '../../../core/services/notification.service';
import { DeliveryAssignment } from '../../../core/models/order.model';
import { PhotoCaptureFieldComponent } from '../../../shared/components/photo-capture-field/photo-capture-field.component';

/**
 * Pantalla 2 de la entrega (Docs plan-repartidor-dos-pantallas): evidencia
 * (foto + firma) y el cierre de la entrega. Vive en su propia ruta
 * (`entregas/:id/evidencia`), separada de la información del pedido
 * (`delivery-detail-info.component`, `entregas/:id`), para que el botón
 * físico de "atrás" del celular navegue entre ambas de forma predecible.
 *
 * "Guardar evidencia" solo pide foto + firma. "Finalizar entrega" aparece
 * después de guardarla al menos una vez, y exige además que no haya saldo
 * pendiente (o que la venta sea Crédito Tienda / Apartado). Al finalizar, el
 * envío del ticket por WhatsApp es "mejor esfuerzo": si falla, la entrega
 * queda completada de todos modos y se puede reenviar el ticket a mano.
 */
@Component({
  selector: 'app-delivery-detail-evidence',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './delivery-detail-evidence.component.html',
  styleUrl: './delivery-detail-evidence.component.scss',
  imports: [CurrencyPipe, RouterLink, PhotoCaptureFieldComponent],
})
export class DeliveryDetailEvidenceComponent implements OnInit, AfterViewInit, OnDestroy {
  private deliveryService = inject(DeliveryService);
  private ticketsService = inject(TicketsService);
  private notification = inject(NotificationService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  private canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('signature');

  protected assignment = signal<DeliveryAssignment | null>(null);
  protected loading = signal(true);
  protected saving = signal(false);

  // ===== Aceptar / rechazar la entrega asignada (plan repartidor-acepta-entrega) =====
  // Defensa en profundidad: normalmente se acepta desde la pantalla de
  // Información, pero esta pantalla tiene su propia ruta y se puede navegar
  // aquí directo por URL.
  protected acceptRejectWorking = signal(false);
  protected rejectModalOpen = signal(false);
  protected rejectReasonText = signal('');

  protected photoData = signal<string | null>(null);
  protected hasSignature = signal(false);

  /**
   * Firma en pantalla completa (sólo celular): al tocar el recuadro de firma
   * ocupa todo el viewport y se fuerza horizontal por CSS, para que el
   * repartidor le pase el teléfono al cliente y firme cómodo.
   */
  protected signatureExpanded = signal(false);

  private ctx: CanvasRenderingContext2D | null = null;
  private drawing = false;

  /** Ya se guardó evidencia al menos una vez (o ya venía guardada del servidor): habilita "Finalizar entrega". */
  protected evidenceSaved = signal(false);

  protected deliveryCompleted = computed(() => this.assignment()?.deliveryStatus === 'completed');

  /**
   * Una vez que la entrega está 'completed', la firma queda congelada: no se
   * puede volver a trazar sobre ella, agregar una nueva ni borrarla. El canvas
   * sólo se usa para MOSTRAR la firma que se guardó al cerrar la entrega.
   */
  protected signatureLocked = this.deliveryCompleted;

  protected balance = computed(() => {
    const a = this.assignment();
    return a ? Math.max(0, a.totalAmount - a.paymentAmount) : 0;
  });

  /**
   * No se puede finalizar una entrega con saldo por cobrar: hay que registrar
   * el cobro primero (en la pantalla de Información). Excepciones: Crédito
   * Tienda (el saldo se financia y se liquida a plazos después de la
   * entrega) y Apartado (el cliente puede seguir abonando). El backend aplica
   * la misma regla (deliveryController.updateStatus) — esto solo es para
   * bloquear el botón y avisar en pantalla antes de intentarlo.
   */
  protected balanceBlocksCompletion = computed(() => {
    const a = this.assignment();
    if (!a || a.deliveryStatus === 'completed') return false;
    return a.paymentMethod !== 'store_credit' && a.paymentMethod !== 'layaway' && this.balance() > 0.01;
  });

  ngOnInit(): void {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.load(id);
  }

  ngAfterViewInit(): void {
    // El canvas puede no existir aún si sigue cargando; se inicializa en load().
    this.initCanvas();
  }

  private load(id: number): void {
    this.loading.set(true);
    this.deliveryService.getAssignment(id).subscribe({
      next: (res) => {
        this.assignment.set(res.data);
        this.photoData.set(res.data.photoUrl ?? null);
        this.evidenceSaved.set(
          res.data.deliveryStatus === 'completed' || (!!res.data.photoUrl && !!res.data.signatureImageUrl),
        );
        this.loading.set(false);
        // El toggle de loading destruye y recrea el <canvas>; hay que reenganchar el contexto.
        this.ctx = null;
        this.hasSignature.set(false);
        // Espera al render para enganchar el canvas.
        setTimeout(() => {
          this.initCanvas();
          if (res.data.signatureImageUrl) this.restoreSignature(res.data.signatureImageUrl);
        });
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudo cargar la entrega');
      },
    });
  }

  private initCanvas(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas || this.ctx) return;
    // Sin ancho todavía (layout no aplicado): no se fija el contexto para que
    // un intento posterior (onPointerDown, restoreSignature) lo reintente con
    // el canvas ya medido — si no, el bitmap quedaría de 0px.
    if (!canvas.offsetWidth) return;
    this.sizeCanvas(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    this.configureCtx(ctx);
    this.ctx = ctx;
  }

  /** El alto es fijo (180) en el recuadro normal; en pantalla completa lo da el flexbox. */
  private sizeCanvas(canvas: HTMLCanvasElement): void {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight || 180;
  }

  private configureCtx(ctx: CanvasRenderingContext2D): void {
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1a1a2e';
  }

  /**
   * Cambiar el tamaño del canvas borra su contenido, así que se respalda la
   * firma ya dibujada y se restaura al nuevo tamaño (entrar/salir de pantalla
   * completa).
   */
  private resizeCanvasPreserving(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;
    const dataUrl = this.hasSignature() ? canvas.toDataURL('image/png') : null;
    this.sizeCanvas(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    this.configureCtx(ctx);
    this.ctx = ctx;
    if (dataUrl) this.restoreSignature(dataUrl);
  }

  protected isMobileViewport(): boolean {
    return typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
  }

  /** Primer toque sobre la firma en celular: expande a pantalla completa en vez de dibujar. */
  protected onCanvasPointerDown(event: PointerEvent): void {
    // Entrega cerrada: la firma está congelada, ignora cualquier toque.
    if (this.signatureLocked()) {
      event.preventDefault();
      return;
    }
    if (!this.signatureExpanded() && this.isMobileViewport()) {
      event.preventDefault();
      this.openSignatureFullscreen();
      return;
    }
    this.onPointerDown(event);
  }

  protected openSignatureFullscreen(): void {
    if (this.signatureLocked() || this.signatureExpanded()) return;
    this.signatureExpanded.set(true);
    document.body.style.overflow = 'hidden';
    setTimeout(() => this.resizeCanvasPreserving());
  }

  protected closeSignatureFullscreen(): void {
    if (!this.signatureExpanded()) return;
    this.signatureExpanded.set(false);
    document.body.style.overflow = '';
    setTimeout(() => this.resizeCanvasPreserving());
  }

  ngOnDestroy(): void {
    if (this.signatureExpanded()) document.body.style.overflow = '';
  }

  /**
   * Vuelve a pintar la firma guardada sobre el canvas.
   *
   * En una entrega ya completada, al recargar la página el canvas puede
   * existir en el DOM pero todavía sin ancho real: se acaba de cambiar de la
   * vista "Cargando…" a la del detalle y el layout aún no se aplica. Se
   * espera (por frames) a que el canvas mida, luego se (re)dimensiona y se
   * dibuja la imagen.
   */
  private restoreSignature(dataUrl: string): void {
    const img = new Image();
    img.onload = () => {
      let tries = 0;
      const draw = () => {
        const canvas = this.canvasRef()?.nativeElement;
        if (!canvas) return;
        if (!canvas.offsetWidth && tries++ < 30) {
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(draw);
          else setTimeout(draw, 50);
          return;
        }
        this.sizeCanvas(canvas);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        this.configureCtx(ctx);
        this.ctx = ctx;
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        this.hasSignature.set(true);
      };
      draw();
    };
    img.src = dataUrl;
  }

  /**
   * Posición del puntero EN COORDENADAS DEL CANVAS.
   *
   * `offsetX/offsetY` vienen en el sistema de coordenadas LOCAL del canvas
   * (sin rotar por el `transform` de pantalla completa), y se escalan por si
   * el buffer del canvas no mide lo mismo que su caja en pantalla.
   */
  private pos(event: PointerEvent): { x: number; y: number } {
    const canvas = this.canvasRef()!.nativeElement;
    const scaleX = canvas.width / (canvas.clientWidth || canvas.width);
    const scaleY = canvas.height / (canvas.clientHeight || canvas.height);
    return { x: event.offsetX * scaleX, y: event.offsetY * scaleY };
  }

  protected onPointerDown(event: PointerEvent): void {
    if (this.signatureLocked()) return;
    this.initCanvas();
    if (!this.ctx) return;
    this.drawing = true;
    const { x, y } = this.pos(event);
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    (event.target as HTMLCanvasElement).setPointerCapture(event.pointerId);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (this.signatureLocked() || !this.drawing || !this.ctx) return;
    const { x, y } = this.pos(event);
    this.ctx.lineTo(x, y);
    this.ctx.stroke();
    this.hasSignature.set(true);
  }

  protected onPointerUp(): void {
    this.drawing = false;
  }

  protected clearSignature(): void {
    if (this.signatureLocked()) return;
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas || !this.ctx) return;
    this.ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.hasSignature.set(false);
  }

  /** Red de seguridad: una foto ya guardada (de otro navegador/dispositivo) que no se puede decodificar aquí. */
  protected onPhotoRenderError(): void {
    this.notification.error('No se pudo mostrar la foto guardada; puede estar en un formato no compatible.');
  }

  /**
   * Exige foto Y firma antes de guardar/completar. Devuelve false y avisa
   * exactamente qué falta ("la foto", "la firma" o ambas).
   */
  private requirePhotoAndSignature(): boolean {
    const missing: string[] = [];
    if (!this.photoData()) missing.push('la foto del mueble');
    if (!this.hasSignature()) missing.push('la firma del cliente');
    if (missing.length === 0) return true;
    this.notification.error(`Debes agregar ${missing.join(' y ')} antes de guardar.`);
    return false;
  }

  protected saveProof(): void {
    const a = this.assignment();
    if (!a) return;
    if (!this.requirePhotoAndSignature()) return;
    const canvas = this.canvasRef()?.nativeElement;
    const signature = this.hasSignature() && canvas ? canvas.toDataURL('image/png') : undefined;
    this.saving.set(true);
    this.deliveryService
      .saveProof(a.id, { signatureImageUrl: signature, photoUrl: this.photoData() ?? undefined })
      .subscribe({
        next: (res) => {
          this.assignment.set(res.data);
          this.saving.set(false);
          this.evidenceSaved.set(true);
          this.notification.success('Evidencia guardada');
        },
        error: (err: { error?: { message?: string } }) => {
          this.saving.set(false);
          this.notification.error(err?.error?.message ?? 'No se pudo guardar la evidencia');
        },
      });
  }

  /**
   * Guarda la evidencia (por si cambió desde el último "Guardar") y cierra la
   * entrega. El envío del ticket por WhatsApp es mejor esfuerzo: si falla, la
   * entrega queda completada de todos modos (se puede reenviar el ticket a
   * mano desde el aviso de "Entrega completada").
   */
  protected finalizeDelivery(): void {
    const a = this.assignment();
    if (!a) return;
    if (!this.requirePhotoAndSignature()) return;
    if (this.balanceBlocksCompletion()) {
      const pend = this.balance().toLocaleString('es-MX', {
        style: 'currency', currency: 'MXN', minimumFractionDigits: 2,
      });
      this.notification.error(
        `No puedes finalizar la entrega: faltan ${pend} por cobrar. `
        + 'Ve a "Información de entrega" y usa "Registrar cobro" antes de finalizar.',
      );
      return;
    }

    // La ventana se abre ANTES de las llamadas async: si se abre en el
    // callback ya no cuenta como originada por el clic y Safari/iOS la
    // bloquea, que es justo donde trabaja el repartidor.
    const win = window.open('', '_blank');
    const canvas = this.canvasRef()?.nativeElement;
    const signature = canvas ? canvas.toDataURL('image/png') : undefined;
    this.saving.set(true);
    this.deliveryService
      .saveProof(a.id, { signatureImageUrl: signature, photoUrl: this.photoData() ?? undefined })
      .subscribe({
        next: () => {
          this.deliveryService.updateStatus(a.id, 'completed').subscribe({
            next: (res) => {
              this.assignment.set(res.data);
              this.saving.set(false);
              this.evidenceSaved.set(true);
              this.notification.success('Entrega completada');
              this.sendTicketWhatsApp(win);
            },
            error: (err: { error?: { message?: string } }) => {
              this.saving.set(false);
              win?.close();
              this.notification.error(err?.error?.message ?? 'No se pudo completar la entrega');
            },
          });
        },
        error: (err: { error?: { message?: string } }) => {
          this.saving.set(false);
          win?.close();
          this.notification.error(err?.error?.message ?? 'No se pudo guardar la evidencia');
        },
      });
  }

  /** Está emitiendo el link del ticket para WhatsApp. */
  protected sharing = signal(false);

  /**
   * Manda el ticket al cliente por WhatsApp. El repartidor no carga impresora
   * térmica, así que el comprobante del cobro en entrega es digital: el mismo
   * ticket que manda el vendedor al crear el pedido.
   *
   * Se llama automáticamente al finalizar (con `win` ya abierta desde el
   * clic original) y también sirve como reenvío manual desde el aviso de
   * "Entrega completada" (sin `win`, abre la suya propia) — si el envío
   * automático falla, la entrega ya quedó cerrada y esto es la forma de
   * recuperarse sin tener que rehacer nada.
   */
  protected sendTicketWhatsApp(win: Window | null = null): void {
    const a = this.assignment();
    if (!a || this.sharing()) return;

    const target = win ?? window.open('', '_blank');
    this.sharing.set(true);

    this.deliveryService.createShareUrl(a.id).subscribe({
      next: (url) => {
        this.sharing.set(false);
        const wa = this.ticketsService.buildWhatsAppUrl(
          {
            customerName: a.customerName,
            customerPhone: a.customerPhone,
            orderNumber: a.orderNumber,
            totalAmount: a.totalAmount,
            balance: this.balance(),
          },
          url,
        );

        if (target) target.location.href = wa;
        else window.open(wa, '_blank');
      },
      error: (err: { error?: { message?: string } }) => {
        this.sharing.set(false);
        target?.close();
        this.notification.error(
          err?.error?.message ?? 'No se pudo generar el link del ticket. La entrega sigue completada; puedes reintentar.',
        );
      },
    });
  }

  protected goToInfo(): void {
    const a = this.assignment();
    this.router.navigate(a ? ['/repartidor/entregas', a.id] : ['/repartidor/entregas']);
  }

  protected acceptDelivery(): void {
    const a = this.assignment();
    if (!a || this.acceptRejectWorking()) return;
    this.acceptRejectWorking.set(true);
    this.deliveryService.acceptAssignment(a.id).subscribe({
      next: (res) => {
        this.acceptRejectWorking.set(false);
        this.assignment.set(res.data);
        this.notification.success(res.message ?? 'Entrega aceptada');
      },
      error: (err: { error?: { message?: string } }) => {
        this.acceptRejectWorking.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo aceptar la entrega');
      },
    });
  }

  protected openRejectModal(): void {
    this.rejectReasonText.set('');
    this.rejectModalOpen.set(true);
  }

  protected submitRejectDelivery(): void {
    const a = this.assignment();
    const reason = this.rejectReasonText().trim();
    if (!a) return;
    if (!reason) {
      this.notification.error('Escribe el motivo del rechazo');
      return;
    }
    this.acceptRejectWorking.set(true);
    this.deliveryService.rejectAssignment(a.id, reason).subscribe({
      next: (res) => {
        this.acceptRejectWorking.set(false);
        this.rejectModalOpen.set(false);
        this.notification.success(res.message ?? 'Rechazo registrado');
        this.router.navigate(['/repartidor/entregas']);
      },
      error: (err: { error?: { message?: string } }) => {
        this.acceptRejectWorking.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo registrar el rechazo');
      },
    });
  }
}
