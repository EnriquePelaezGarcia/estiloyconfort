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
import { CurrencyPipe, DatePipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { CurrencyInputDirective } from '../../../shared/directives/currency-input.directive';
import { DeliveryService } from '../../../core/services/delivery.service';
import { TicketsService } from '../../../core/services/tickets.service';
import { NotificationService } from '../../../core/services/notification.service';
import { DiscountsService } from '../../../core/services/discounts.service';
import { formatWindow } from '../../../core/services/delivery-schedule.service';
import {
  DeliveryAssignment, DiscountReasonCategory, PaymentInstrument, PaymentStatus, SaleScheme,
} from '../../../core/models/order.model';
import {
  PAYMENT_INSTRUMENT_LABELS,
  PAYMENT_STATUS_LABELS,
  PAYMENT_STATUS_TONE,
  SALE_SCHEME_LABELS,
} from '../../../core/models/order-labels';
import { DiscountReasonPickerComponent } from '../../../shared/components/discount-reason-picker/discount-reason-picker.component';
import { MediaUrlPipe } from '../../../shared/pipes/media-url.pipe';

@Component({
  selector: 'app-delivery-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './delivery-detail.component.html',
  styleUrl: './delivery-detail.component.scss',
  imports: [
    CurrencyPipe,
    DatePipe,
    ReactiveFormsModule,
    CurrencyInputDirective,
    DiscountReasonPickerComponent,
    MediaUrlPipe,
  ],
})
export class DeliveryDetailComponent implements OnInit, AfterViewInit, OnDestroy {
  private deliveryService = inject(DeliveryService);
  private ticketsService = inject(TicketsService);
  private notification = inject(NotificationService);
  private discountsService = inject(DiscountsService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  private canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('signature');
  private fileInputRef = viewChild<ElementRef<HTMLInputElement>>('photoFileInput');
  private videoRef = viewChild<ElementRef<HTMLVideoElement>>('cameraVideo');

  protected assignment = signal<DeliveryAssignment | null>(null);
  protected loading = signal(true);

  /** '1:00pm – 3:00pm', o '' si el pedido no tiene ventana capturada. */
  protected windowOf(a: DeliveryAssignment): string {
    return formatWindow(a.deliveryWindowStart, a.deliveryWindowEnd);
  }
  protected saving = signal(false);

  protected photoData = signal<string | null>(null);
  /** Foto de evidencia del intento fallido ("no había nadie"). Obligatoria para reportarlo. */
  protected failPhotoData = signal<string | null>(null);
  /**
   * A qué foto va la próxima captura: la evidencia de entrega ('proof') o la
   * del intento fallido ('fail'). Lo fija openPhotoCapture() antes de abrir la
   * cámara / el selector.
   */
  private photoTarget: 'proof' | 'fail' = 'proof';
  /** Convirtiendo/validando la foto elegida (p.ej. HEIC de iPhone → JPEG). */
  protected photoProcessing = signal(false);
  /**
   * Cámara en vivo (sólo celular): en vez de abrir el selector nativo (que en
   * algunos navegadores ofrece "Galería" además de la cámara), se pide acceso
   * a la cámara con getUserMedia y se toma la foto dentro de la app — así se
   * garantiza que sólo se pueda capturar en directo, nunca subir una imagen
   * ya existente. En escritorio o si el navegador no soporta getUserMedia se
   * usa el selector de archivos de siempre (ver openPhotoCapture()).
   */
  protected cameraOpen = signal(false);
  private mediaStream: MediaStream | null = null;
  protected hasSignature = signal(false);
  protected paymentModalOpen = signal(false);
  protected savingPayment = signal(false);

  /**
   * Firma en pantalla completa (sólo celular): al tocar el recuadro de firma
   * ocupa todo el viewport y se fuerza horizontal por CSS (ver
   * .signature-wrap--fullscreen), para que el repartidor le pase el teléfono
   * al cliente y firme cómodo.
   */
  protected signatureExpanded = signal(false);

  private ctx: CanvasRenderingContext2D | null = null;
  private drawing = false;

  protected balance = computed(() => {
    const a = this.assignment();
    return a ? Math.max(0, a.totalAmount - a.paymentAmount) : 0;
  });

  // ===== Descuento (Docs/plan-descuentos.md, RN-D2: solo dinero) =====
  protected discountModalOpen = signal(false);
  protected savingDiscount = signal(false);
  protected discountAmount = signal<number | null>(null);
  protected discountReasonCategory = signal<DiscountReasonCategory | null>(null);
  protected discountReasonText = signal<string>('');
  /** El descuento en dinero activo del pedido (pending/approved), si lo hay. */
  protected activeMoneyDiscount = computed(
    () => (this.assignment()?.discounts ?? []).find((d) => d.type === 'money' && d.status !== 'rejected') ?? null,
  );

  protected canComplete = computed(
    () => this.hasSignature() && !!this.photoData() && this.assignment()?.deliveryStatus !== 'completed',
  );

  /** ¿La venta fue a Crédito Tienda? */
  protected isCredit = computed(() => this.assignment()?.paymentMethod === 'store_credit');

  /** ¿La venta fue Apartado? */
  protected isLayaway = computed(() => this.assignment()?.paymentMethod === 'layaway');

  /** Instrumentos de cobro permitidos según la condición de venta del pedido. */
  protected allowedInstruments = computed<PaymentInstrument[]>(() => {
    switch (this.assignment()?.paymentMethod) {
      case 'msi':
        return ['msi', 'cash', 'transfer'];
      case 'store_credit':
      case 'layaway':
        return ['cash', 'transfer'];
      default: // 'cash' = Contado
        return ['cash', 'card', 'transfer'];
    }
  });

  /** Cobro dividido: una o varias líneas (instrumento + monto) que suman el total. */
  protected paymentForm = this.fb.group({
    lines: this.fb.array([this.buildLine()]),
  });

  protected get paymentLines() {
    return this.paymentForm.controls.lines;
  }

  private linesValue = toSignal(this.paymentLines.valueChanges, {
    initialValue: this.paymentLines.value,
  });

  /** Suma de todas las líneas del cobro actual. */
  protected payTotal = computed(() =>
    this.linesValue().reduce((sum, l) => sum + (Number(l.amount) || 0), 0),
  );

  private buildLine(amount = 0, instrument: PaymentInstrument = 'cash') {
    return this.fb.group({
      paymentMethod: [instrument, Validators.required],
      amount: [amount, [Validators.required, Validators.min(1)]],
    });
  }

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
        this.loading.set(false);
        // El backend ya marcó como vistos los descuentos rechazados de este
        // repartidor en este pedido (al abrir la entrega) — se refresca el
        // badge del sidebar para que lo refleje.
        this.discountsService.refreshMyRejectedCount().subscribe({ error: () => {} });
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
    const completed = this.assignment()?.deliveryStatus === 'completed';
    if (!completed && !this.signatureExpanded() && this.isMobileViewport()) {
      event.preventDefault();
      this.openSignatureFullscreen();
      return;
    }
    this.onPointerDown(event);
  }

  protected openSignatureFullscreen(): void {
    if (this.assignment()?.deliveryStatus === 'completed' || this.signatureExpanded()) return;
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
    if (this.signatureExpanded() || this.cameraOpen()) document.body.style.overflow = '';
    this.stopCameraStream();
  }

  /**
   * Punto de entrada del botón "Tomar foto". En celular abre la cámara en
   * vivo dentro de la app (garantiza foto en directo, sin opción de galería);
   * en escritorio, o si el navegador no soporta getUserMedia / el usuario
   * niega el permiso, cae al selector de archivos nativo como respaldo.
   */
  protected async openPhotoCapture(target: 'proof' | 'fail' = 'proof'): Promise<void> {
    this.photoTarget = target;
    // 'proof' no tiene sentido en una entrega ya completada; 'fail' tampoco,
    // pero el botón sólo existe mientras no lo esté.
    if (this.assignment()?.deliveryStatus === 'completed') return;
    if (!this.isMobileViewport() || !navigator.mediaDevices?.getUserMedia) {
      this.fileInputRef()?.nativeElement.click();
      return;
    }
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      this.cameraOpen.set(true);
      document.body.style.overflow = 'hidden';
      // Espera al render del <video> antes de engancharle el stream.
      setTimeout(() => {
        const video = this.videoRef()?.nativeElement;
        if (!video) return;
        video.srcObject = this.mediaStream;
        video.play().catch(() => {});
      });
    } catch {
      this.notification.error('No se pudo abrir la cámara. Elige una foto desde el teléfono.');
      this.fileInputRef()?.nativeElement.click();
    }
  }

  /** Toma el cuadro actual del video como foto y cierra la cámara. */
  protected capturePhoto(): void {
    const video = this.videoRef()?.nativeElement;
    if (!video || !video.videoWidth) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    this.setCapturedPhoto(canvas.toDataURL('image/jpeg', 0.9));
    this.closeCamera();
  }

  /** Enruta la foto recién obtenida a la evidencia de entrega o a la del intento fallido. */
  private setCapturedPhoto(dataUrl: string): void {
    if (this.photoTarget === 'fail') this.failPhotoData.set(dataUrl);
    else this.photoData.set(dataUrl);
  }

  protected closeCamera(): void {
    this.stopCameraStream();
    this.cameraOpen.set(false);
    document.body.style.overflow = '';
  }

  private stopCameraStream(): void {
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
  }

  private restoreSignature(dataUrl: string): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas || !this.ctx) return;
    const img = new Image();
    img.onload = () => {
      this.ctx!.drawImage(img, 0, 0, canvas.width, canvas.height);
      this.hasSignature.set(true);
    };
    img.src = dataUrl;
  }

  /**
   * Posición del puntero EN COORDENADAS DEL CANVAS.
   *
   * Antes se usaba `getBoundingClientRect()` + `clientX/clientY`: en pantalla
   * completa el recuadro de firma se rota 90° por CSS (ver
   * .signature-wrap--fullscreen en el .scss) y ese cálculo sí se ve afectado
   * por el `transform`, así que el trazo salía girado y desplazado hacia abajo.
   *
   * `offsetX/offsetY` vienen en el sistema de coordenadas LOCAL del canvas
   * (sin rotar), y se escalan por si el buffer del canvas no mide lo mismo que
   * su caja en pantalla.
   */
  private pos(event: PointerEvent): { x: number; y: number } {
    const canvas = this.canvasRef()!.nativeElement;
    const scaleX = canvas.width / (canvas.clientWidth || canvas.width);
    const scaleY = canvas.height / (canvas.clientHeight || canvas.height);
    return { x: event.offsetX * scaleX, y: event.offsetY * scaleY };
  }

  protected onPointerDown(event: PointerEvent): void {
    this.initCanvas();
    if (!this.ctx) return;
    this.drawing = true;
    const { x, y } = this.pos(event);
    this.ctx.beginPath();
    this.ctx.moveTo(x, y);
    (event.target as HTMLCanvasElement).setPointerCapture(event.pointerId);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.drawing || !this.ctx) return;
    const { x, y } = this.pos(event);
    this.ctx.lineTo(x, y);
    this.ctx.stroke();
    this.hasSignature.set(true);
  }

  protected onPointerUp(): void {
    this.drawing = false;
  }

  protected clearSignature(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas || !this.ctx) return;
    this.ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.hasSignature.set(false);
  }

  /**
   * Antes esto sólo leía el archivo con FileReader y lo mostraba tal cual: si
   * el formato no lo podía decodificar el navegador (HEIC de iPhone en
   * Chrome/Android, TIFF, RAW, etc.) quedaba una foto rota sin ningún aviso.
   * Ahora: valida que sea una imagen, convierte HEIC/HEIF a JPEG (el formato
   * por defecto de la cámara de iPhone, que Chrome/Android no puede mostrar)
   * y confirma que el navegador puede decodificar el resultado antes de
   * aceptarlo — si algo falla, se avisa con un error en vez de quedar mudo.
   */
  protected onPhotoSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // permite reintentar con el mismo archivo si falla
    if (!file) return;

    if (!this.isSupportedImageFile(file)) {
      this.notification.error('Ese archivo no es una imagen. Usa JPG, PNG, WEBP o HEIC.');
      return;
    }

    this.photoProcessing.set(true);
    this.readImageFile(file)
      .then((dataUrl) => this.verifyImageDecodes(dataUrl))
      .then((dataUrl) => {
        this.setCapturedPhoto(dataUrl);
        this.photoProcessing.set(false);
      })
      .catch((err: unknown) => {
        this.photoProcessing.set(false);
        this.notification.error(
          err instanceof Error && err.message
            ? err.message
            : 'No se pudo procesar la foto. Intenta con otra imagen (JPG o PNG).',
        );
      });
  }

  /** HEIC/HEIF = foto por defecto de iPhone; Chrome/Android no la puede mostrar. */
  private isHeic(file: File): boolean {
    const type = file.type.toLowerCase();
    const name = file.name.toLowerCase();
    return type === 'image/heic' || type === 'image/heif' || name.endsWith('.heic') || name.endsWith('.heif');
  }

  private isSupportedImageFile(file: File): boolean {
    return file.type.startsWith('image/') || this.isHeic(file);
  }

  private async readImageFile(file: File): Promise<string> {
    let source: Blob = file;
    if (this.isHeic(file)) {
      const heic2any = (await import('heic2any')).default;
      const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
      source = Array.isArray(converted) ? converted[0] : converted;
    }
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error('No se pudo leer el archivo de la foto.'));
      reader.readAsDataURL(source);
    });
  }

  /** Confirma que el navegador puede decodificar/mostrar la imagen antes de aceptarla. */
  private verifyImageDecodes(dataUrl: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(dataUrl);
      img.onerror = () =>
        reject(new Error('Este formato de imagen no es compatible con el navegador. Usa JPG, PNG o WEBP.'));
      img.src = dataUrl;
    });
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
          this.notification.success('Evidencia guardada');
        },
        error: (err: { error?: { message?: string } }) => {
          this.saving.set(false);
          this.notification.error(err?.error?.message ?? 'No se pudo guardar la evidencia');
        },
      });
  }

  protected markDelivered(): void {
    const a = this.assignment();
    if (!a) return;
    if (!this.requirePhotoAndSignature()) return;
    const canvas = this.canvasRef()?.nativeElement;
    const signature = canvas ? canvas.toDataURL('image/png') : undefined;
    this.saving.set(true);
    // Guarda evidencia y luego marca como completada.
    this.deliveryService
      .saveProof(a.id, { signatureImageUrl: signature, photoUrl: this.photoData() ?? undefined })
      .subscribe({
        next: () => {
          this.deliveryService.updateStatus(a.id, 'completed').subscribe({
            next: (res) => {
              this.assignment.set(res.data);
              this.saving.set(false);
              this.notification.success('Entrega completada');
            },
            error: (err: { error?: { message?: string } }) => {
              this.saving.set(false);
              this.notification.error(err?.error?.message ?? 'No se pudo completar la entrega');
            },
          });
        },
        error: (err: { error?: { message?: string } }) => {
          this.saving.set(false);
          this.notification.error(err?.error?.message ?? 'No se pudo guardar la evidencia');
        },
      });
  }

  protected startRoute(): void {
    const a = this.assignment();
    if (a) this.deliveryService.updateStatus(a.id, 'in_progress').subscribe({
      next: (res) => this.assignment.set(res.data),
    });
  }

  // ===== "No se pudo entregar" (Plan rastreo, Hueco 1) =====
  protected readonly failReasons = [
    'No había nadie / cliente ausente',
    'Dirección incorrecta',
    'Cliente rechazó el pedido',
    'Sin acceso al domicilio',
    'Mueble dañado en tránsito',
    'Otro',
  ];
  protected failModalOpen = signal(false);
  protected failReason = signal<string>('');
  protected failReasonOther = signal<string>('');
  protected savingFail = signal(false);

  protected openFailModal(): void {
    this.failReason.set('');
    this.failReasonOther.set('');
    this.failPhotoData.set(null);
    this.failModalOpen.set(true);
  }

  protected submitFail(): void {
    const a = this.assignment();
    if (!a) return;
    const selected = this.failReason();
    if (!selected) {
      this.notification.error('Selecciona el motivo');
      return;
    }
    const reason = selected === 'Otro' ? this.failReasonOther().trim() : selected;
    if (!reason) {
      this.notification.error('Escribe el motivo');
      return;
    }
    const evidence = this.failPhotoData();
    if (!evidence) {
      this.notification.error('Agrega una foto de evidencia del intento fallido');
      return;
    }
    this.savingFail.set(true);
    this.deliveryService.markFailed(a.id, reason, evidence).subscribe({
      next: () => {
        this.savingFail.set(false);
        this.failModalOpen.set(false);
        this.notification.success('Se registró el intento. El pedido volvió a "Listo" para reprogramarse.');
        this.goBack();
      },
      error: (err: { error?: { message?: string } }) => {
        this.savingFail.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo registrar el intento');
      },
    });
  }

  /** Docs/plan-descuentos.md: pide un descuento en dinero (ej. mueble dañado en el trayecto). */
  protected openDiscountModal(): void {
    this.discountAmount.set(null);
    this.discountReasonCategory.set(null);
    this.discountReasonText.set('');
    this.discountModalOpen.set(true);
  }

  protected onDiscountAmountInput(event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    const value = Number(raw);
    this.discountAmount.set(raw === '' || Number.isNaN(value) || value <= 0 ? null : value);
  }

  protected setDiscountReasonCategory(category: DiscountReasonCategory): void {
    this.discountReasonCategory.set(category);
  }

  protected setDiscountReasonText(reason: string): void {
    this.discountReasonText.set(reason);
  }

  protected submitDiscount(): void {
    const a = this.assignment();
    const amount = this.discountAmount();
    if (!a || amount == null) {
      this.notification.error('Ingresa el monto a descontar');
      return;
    }
    if (!this.discountReasonCategory()) {
      this.notification.error('Selecciona el motivo del descuento');
      return;
    }
    if (this.discountReasonCategory() === 'otro' && !this.discountReasonText().trim()) {
      this.notification.error('Escribe el motivo del descuento');
      return;
    }
    this.savingDiscount.set(true);
    this.deliveryService.requestDiscount(a.id, {
      amount,
      reasonCategory: this.discountReasonCategory()!,
      reason: this.discountReasonText().trim() || null,
    }).subscribe({
      next: (res) => {
        this.assignment.set(res.data);
        this.savingDiscount.set(false);
        this.discountModalOpen.set(false);
        this.notification.success('Descuento aplicado, pendiente de aprobación del admin');
      },
      error: (err: { error?: { message?: string } }) => {
        this.savingDiscount.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo aplicar el descuento');
      },
    });
  }

  protected openPayment(): void {
    this.paymentLines.clear();
    this.paymentLines.push(this.buildLine(this.balance(), this.allowedInstruments()[0]));
    this.paymentModalOpen.set(true);
  }

  /** Agrega una línea de cobro con el saldo aún por cubrir como sugerencia. */
  protected addLine(): void {
    const remaining = Math.max(0, this.balance() - this.payTotal());
    this.paymentLines.push(this.buildLine(remaining, this.allowedInstruments()[0]));
  }

  protected removeLine(index: number): void {
    if (this.paymentLines.length > 1) {
      this.paymentLines.removeAt(index);
    } else {
      this.paymentLines.at(0).get('amount')?.setValue(null);
    }
  }

  protected instrumentLabel(i: PaymentInstrument): string {
    return PAYMENT_INSTRUMENT_LABELS[i];
  }

  /** Está emitiendo el link del ticket para WhatsApp. */
  protected sharing = signal(false);

  /**
   * Manda el ticket al cliente por WhatsApp. El repartidor no carga impresora
   * térmica, así que el comprobante del cobro en entrega es digital: el mismo
   * ticket que manda el vendedor al crear el pedido.
   *
   * No se genera nada nuevo — la página pública lee datos en vivo, así que el
   * link ya refleja el cobro que se acaba de registrar.
   *
   * La ventana se abre ANTES de la petición y se le asigna la URL después:
   * abrirla dentro del callback la convierte en un popup no originado por el
   * clic y Safari/iOS la bloquea, que es justo donde trabaja el repartidor.
   */
  protected shareWhatsApp(): void {
    const a = this.assignment();
    if (!a || this.sharing()) return;

    const win = window.open('', '_blank');
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

        if (win) win.location.href = wa;
        else window.open(wa, '_blank');
      },
      error: (err: { error?: { message?: string } }) => {
        this.sharing.set(false);
        win?.close();
        this.notification.error(err?.error?.message ?? 'No se pudo generar el link del ticket');
      },
    });
  }

  protected submitPayment(): void {
    if (this.paymentForm.invalid) {
      this.paymentForm.markAllAsTouched();
      return;
    }
    const a = this.assignment();
    if (!a) return;

    const lines = this.paymentLines.getRawValue().map((l) => ({
      amount: Number(l.amount),
      paymentMethod: l.paymentMethod as PaymentInstrument,
    }));
    const amountTotal = lines.reduce((sum, l) => sum + l.amount, 0);

    if (amountTotal <= 0) {
      this.notification.error('Agrega al menos un cobro con monto mayor a 0');
      return;
    }
    if (this.isLayaway() && a.paymentAmount === 0 && amountTotal < 500) {
      this.notification.error('El primer abono en apartado debe ser mínimo $500');
      return;
    }

    this.savingPayment.set(true);
    this.deliveryService.registerPayment(a.id, lines).subscribe({
      next: () => {
        this.notification.success('Cobro registrado');
        this.savingPayment.set(false);
        this.paymentModalOpen.set(false);
        this.load(a.id);
      },
      error: (err: { error?: { message?: string } }) => {
        this.savingPayment.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudo registrar el cobro');
      },
    });
  }

  // ===== Aviso "ya vamos en camino" por WhatsApp (entrega en curso) =====
  /** Plantilla del repartidor, guardada por dispositivo (no hay tabla de preferencias). */
  private readonly enRouteStorageKey = 'delivery:enRouteMessage';
  private readonly defaultEnRouteMessage =
    'Hola, somos del equipo de reparto de Mueblería Estilo y Confort. '
    + 'Te confirmamos que ya vamos camino a tu domicilio.';

  protected enRouteModalOpen = signal(false);
  protected enRouteMessage = signal(this.loadEnRouteMessage());

  private loadEnRouteMessage(): string {
    try {
      return localStorage.getItem(this.enRouteStorageKey)?.trim() || this.defaultEnRouteMessage;
    } catch {
      return this.defaultEnRouteMessage;
    }
  }

  protected openEnRouteModal(): void {
    this.enRouteMessage.set(this.loadEnRouteMessage());
    this.enRouteModalOpen.set(true);
  }

  /** Vuelve al texto por defecto (no borra la plantilla guardada hasta el próximo envío). */
  protected resetEnRouteMessage(): void {
    this.enRouteMessage.set(this.defaultEnRouteMessage);
  }

  /**
   * Guarda el texto actual como plantilla del repartidor en este dispositivo y
   * abre WhatsApp con el mensaje ya escrito para el cliente. Sin teléfono
   * capturado abre el selector de contactos de WhatsApp.
   */
  protected sendEnRouteWhatsApp(): void {
    const a = this.assignment();
    if (!a) return;
    const message = this.enRouteMessage().trim() || this.defaultEnRouteMessage;
    try {
      localStorage.setItem(this.enRouteStorageKey, message);
    } catch { /* modo privado / SSR: el texto sólo aplica a este envío */ }
    const digits = (a.customerPhone ?? '').replace(/\D/g, '');
    const phone = digits.length >= 10 ? digits.slice(-10) : '';
    const text = encodeURIComponent(message);
    window.open(
      phone ? `https://wa.me/52${phone}?text=${text}` : `https://wa.me/?text=${text}`,
      '_blank',
    );
    this.enRouteModalOpen.set(false);
  }

  protected mapsUrl(a: DeliveryAssignment): string {
    // Prioriza el enlace de Google Maps capturado por el vendedor.
    if (a.googleMapsUrl) return a.googleMapsUrl;
    if (a.deliveryAddressLat != null && a.deliveryAddressLng != null) {
      return `https://www.google.com/maps/search/?api=1&query=${a.deliveryAddressLat},${a.deliveryAddressLng}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(a.deliveryAddress ?? '')}`;
  }

  protected goBack(): void {
    this.router.navigate(['/repartidor/entregas']);
  }

  protected payLabel(s: PaymentStatus): string { return PAYMENT_STATUS_LABELS[s]; }
  protected payTone(s: PaymentStatus): string { return PAYMENT_STATUS_TONE[s]; }
  protected schemeLabel(s: SaleScheme): string { return SALE_SCHEME_LABELS[s]; }
}
