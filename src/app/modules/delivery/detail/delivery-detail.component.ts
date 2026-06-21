import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CurrencyPipe } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DeliveryService } from '../../../core/services/delivery.service';
import { NotificationService } from '../../../core/services/notification.service';
import { DeliveryAssignment, PaymentMethod, PaymentStatus } from '../../../core/models/order.model';
import { PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONE } from '../../../core/models/order-labels';

@Component({
  selector: 'app-delivery-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './delivery-detail.component.html',
  styleUrl: './delivery-detail.component.scss',
  imports: [CurrencyPipe, ReactiveFormsModule],
})
export class DeliveryDetailComponent implements OnInit, AfterViewInit {
  private deliveryService = inject(DeliveryService);
  private notification = inject(NotificationService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private fb = inject(FormBuilder);

  private canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('signature');

  protected assignment = signal<DeliveryAssignment | null>(null);
  protected loading = signal(true);
  protected saving = signal(false);

  protected photoData = signal<string | null>(null);
  protected hasSignature = signal(false);
  protected paymentModalOpen = signal(false);
  protected savingPayment = signal(false);

  private ctx: CanvasRenderingContext2D | null = null;
  private drawing = false;

  protected balance = computed(() => {
    const a = this.assignment();
    return a ? Math.max(0, a.totalAmount - a.paymentAmount) : 0;
  });

  protected canComplete = computed(
    () => this.hasSignature() && !!this.photoData() && this.assignment()?.deliveryStatus !== 'completed',
  );

  protected paymentForm = this.fb.group({
    amount: [0, [Validators.required, Validators.min(1)]],
    paymentMethod: ['cash' as PaymentMethod, Validators.required],
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
        this.loading.set(false);
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
    canvas.width = canvas.offsetWidth;
    canvas.height = 180;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1a1a2e';
    this.ctx = ctx;
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

  private pos(event: PointerEvent): { x: number; y: number } {
    const canvas = this.canvasRef()!.nativeElement;
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
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

  protected onPhotoSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => this.photoData.set(reader.result as string);
    reader.readAsDataURL(file);
  }

  protected saveProof(): void {
    const a = this.assignment();
    if (!a) return;
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
        error: () => {
          this.saving.set(false);
          this.notification.error('No se pudo guardar la evidencia');
        },
      });
  }

  protected markDelivered(): void {
    const a = this.assignment();
    if (!a) return;
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
        error: () => {
          this.saving.set(false);
          this.notification.error('No se pudo guardar la evidencia');
        },
      });
  }

  protected startRoute(): void {
    const a = this.assignment();
    if (a) this.deliveryService.updateStatus(a.id, 'in_progress').subscribe({
      next: (res) => this.assignment.set(res.data),
    });
  }

  protected openPayment(): void {
    this.paymentForm.reset({ amount: this.balance(), paymentMethod: this.assignment()?.paymentMethod ?? 'cash' });
    this.paymentModalOpen.set(true);
  }

  protected submitPayment(): void {
    if (this.paymentForm.invalid) {
      this.paymentForm.markAllAsTouched();
      return;
    }
    const a = this.assignment();
    if (!a) return;
    const { amount, paymentMethod } = this.paymentForm.getRawValue();
    this.savingPayment.set(true);
    this.deliveryService.registerPayment(a.id, amount!, paymentMethod!).subscribe({
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

  protected mapsUrl(a: DeliveryAssignment): string {
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
}
