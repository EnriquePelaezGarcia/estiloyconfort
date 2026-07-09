import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { PricingService } from '../../../core/services/pricing.service';
import { NotificationService } from '../../../core/services/notification.service';
import {
  DEFAULT_PRICING_CONFIG,
  PricingConfigItem,
  PricingConfigMap,
} from '../../../core/models/pricing-config.model';

@Component({
  selector: 'app-admin-pricing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pricing.component.html',
  styleUrl: './pricing.component.scss',
  imports: [ReactiveFormsModule],
})
export class PricingComponent implements OnInit {
  private pricingService = inject(PricingService);
  private notification = inject(NotificationService);
  private fb = inject(FormBuilder);

  protected loading = signal(true);
  protected saving = signal(false);
  protected items = signal<PricingConfigItem[]>([]);

  protected form = this.fb.group({
    iva: [DEFAULT_PRICING_CONFIG.iva, [Validators.required, Validators.min(0), Validators.max(100)]],
    card_commission: [DEFAULT_PRICING_CONFIG.card_commission, [Validators.required, Validators.min(0), Validators.max(100)]],
    msi_commission: [DEFAULT_PRICING_CONFIG.msi_commission, [Validators.required, Validators.min(0), Validators.max(100)]],
    rounding_step: [DEFAULT_PRICING_CONFIG.rounding_step, [Validators.required, Validators.min(1)]],
    credit_interest: [DEFAULT_PRICING_CONFIG.credit_interest, [Validators.required, Validators.min(0), Validators.max(100)]],
    credit_initial_pct: [DEFAULT_PRICING_CONFIG.credit_initial_pct, [Validators.required, Validators.min(1), Validators.max(99)]],
    credit_weeks: [DEFAULT_PRICING_CONFIG.credit_weeks, [Validators.required, Validators.min(1), Validators.max(104)]],
    assembly_base: [DEFAULT_PRICING_CONFIG.assembly_base, [Validators.required, Validators.min(0)]],
    assembly_per_floor: [DEFAULT_PRICING_CONFIG.assembly_per_floor, [Validators.required, Validators.min(0)]],
  });

  // ===== Simulador en vivo =====
  protected simForm = this.fb.group({
    baseCost: [1350 as number | null],
    margin: [29.3 as number | null],
  });

  private formValue = signal<PricingConfigMap>({ ...DEFAULT_PRICING_CONFIG });
  private simValue = signal<{ baseCost: number | null; margin: number | null }>({ baseCost: 1350, margin: 29.3 });

  protected simResult = computed(() =>
    PricingService.calculatePrices(this.simValue().baseCost, this.simValue().margin, this.formValue()),
  );

  /** Plan de crédito en tienda calculado sobre el precio de contado simulado. */
  protected creditResult = computed(() =>
    PricingService.calculateCredit(this.simResult().price_cash, this.formValue()),
  );

  protected formValueInitialPct = computed(() => this.formValue().credit_initial_pct);

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      this.formValue.set({
        iva: v.iva ?? DEFAULT_PRICING_CONFIG.iva,
        card_commission: v.card_commission ?? DEFAULT_PRICING_CONFIG.card_commission,
        msi_commission: v.msi_commission ?? DEFAULT_PRICING_CONFIG.msi_commission,
        rounding_step: v.rounding_step ?? DEFAULT_PRICING_CONFIG.rounding_step,
        credit_interest: v.credit_interest ?? DEFAULT_PRICING_CONFIG.credit_interest,
        credit_initial_pct: v.credit_initial_pct ?? DEFAULT_PRICING_CONFIG.credit_initial_pct,
        credit_weeks: v.credit_weeks ?? DEFAULT_PRICING_CONFIG.credit_weeks,
        assembly_base: v.assembly_base ?? DEFAULT_PRICING_CONFIG.assembly_base,
        assembly_per_floor: v.assembly_per_floor ?? DEFAULT_PRICING_CONFIG.assembly_per_floor,
      });
    });

    this.simForm.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      this.simValue.set({ baseCost: v.baseCost ?? null, margin: v.margin ?? null });
    });
  }

  ngOnInit(): void {
    this.pricingService.getConfig().subscribe({
      next: (items) => {
        this.items.set(items);
        const map = PricingService.toMap(items);
        this.form.patchValue(map);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.notification.error('No se pudieron cargar las reglas de precios');
      },
    });
  }

  protected itemMeta(key: string): PricingConfigItem | undefined {
    return this.items().find((i) => i.config_key === key);
  }

  protected money(value: number | string | null): string {
    if (value === null || value === undefined) return '—';
    const num = Number(value);
    return isNaN(num) ? '—' : num.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.pricingService.updateConfig(this.formValue()).subscribe({
      next: (items) => {
        this.items.set(items);
        this.saving.set(false);
        this.notification.success('Reglas de precios actualizadas');
      },
      error: (err: { error?: { message?: string } }) => {
        this.saving.set(false);
        this.notification.error(err?.error?.message ?? 'No se pudieron guardar los cambios');
      },
    });
  }
}
