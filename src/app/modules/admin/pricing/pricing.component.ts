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
import { MATERIAL_LABELS, MATERIALS, ProductMaterial } from '../../../core/models/order.model';

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
    card_commission_base: [DEFAULT_PRICING_CONFIG.card_commission_base, [Validators.required, Validators.min(0), Validators.max(100)]],
    msi_commission_base: [DEFAULT_PRICING_CONFIG.msi_commission_base, [Validators.required, Validators.min(0), Validators.max(100)]],
    rounding_step: [DEFAULT_PRICING_CONFIG.rounding_step, [Validators.required, Validators.min(1)]],
    credit_interest: [DEFAULT_PRICING_CONFIG.credit_interest, [Validators.required, Validators.min(0), Validators.max(100)]],
    credit_initial_pct: [DEFAULT_PRICING_CONFIG.credit_initial_pct, [Validators.required, Validators.min(1), Validators.max(99)]],
    credit_weeks: [DEFAULT_PRICING_CONFIG.credit_weeks, [Validators.required, Validators.min(1), Validators.max(104)]],
    assembly_base: [DEFAULT_PRICING_CONFIG.assembly_base, [Validators.required, Validators.min(0)]],
    assembly_per_floor: [DEFAULT_PRICING_CONFIG.assembly_per_floor, [Validators.required, Validators.min(0)]],
    // RN-10 — factor de mayoreo, uno por material.
    wholesale_factor_mdf: [DEFAULT_PRICING_CONFIG.wholesale_factor_mdf, [Validators.required, Validators.min(0.01)]],
    wholesale_factor_blanca: [DEFAULT_PRICING_CONFIG.wholesale_factor_blanca, [Validators.required, Validators.min(0.01)]],
    wholesale_factor_color: [DEFAULT_PRICING_CONFIG.wholesale_factor_color, [Validators.required, Validators.min(0.01)]],
    min_margin_alert: [DEFAULT_PRICING_CONFIG.min_margin_alert, [Validators.required, Validators.min(0), Validators.max(100)]],
  });

  protected readonly materials = MATERIALS;
  protected readonly materialLabels = MATERIAL_LABELS;

  // ===== Simulador en vivo =====
  protected simForm = this.fb.group({
    baseCost: [1350 as number | null],
    margin: [29.3 as number | null],
    material: ['MDF' as ProductMaterial],
  });

  private formValue = signal<PricingConfigMap>({ ...DEFAULT_PRICING_CONFIG });
  private simValue = signal<{ baseCost: number | null; margin: number | null; material: ProductMaterial }>({
    baseCost: 1350,
    margin: 29.3,
    material: 'MDF',
  });

  protected simResult = computed(() =>
    PricingService.calculatePrices(this.simValue().baseCost, this.simValue().margin, this.formValue()),
  );

  /** RN-10 — precio de mayoreo simulado: directo sobre el costo, sin margen ni IVA. */
  protected simWholesale = computed(() =>
    PricingService.calculateWholesalePrice(this.simValue().baseCost, this.simValue().material, this.formValue()),
  );

  /** Plan de crédito en tienda calculado sobre el precio de contado simulado. */
  protected creditResult = computed(() =>
    PricingService.calculateCredit(this.simResult().price_cash, this.formValue()),
  );

  protected formValueInitialPct = computed(() => this.formValue().credit_initial_pct);

  /**
   * Comisiones netas derivadas de las base. La terminal cobra IVA sobre su
   * propia comisión, así que la neta es base × (1 + IVA). Son de solo lectura:
   * si se guardaran aparte, un cambio de tarifa dejaría el sistema inconsistente.
   */
  protected netCommissions = computed(() => {
    const { card, msi } = PricingService.netCommissions(this.formValue());
    const pct = (n: number) => `${(n * 100).toFixed(4)} %`;
    return { card: pct(card), msi: pct(msi) };
  });

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      this.formValue.set({
        iva: v.iva ?? DEFAULT_PRICING_CONFIG.iva,
        card_commission_base: v.card_commission_base ?? DEFAULT_PRICING_CONFIG.card_commission_base,
        msi_commission_base: v.msi_commission_base ?? DEFAULT_PRICING_CONFIG.msi_commission_base,
        rounding_step: v.rounding_step ?? DEFAULT_PRICING_CONFIG.rounding_step,
        credit_interest: v.credit_interest ?? DEFAULT_PRICING_CONFIG.credit_interest,
        credit_initial_pct: v.credit_initial_pct ?? DEFAULT_PRICING_CONFIG.credit_initial_pct,
        credit_weeks: v.credit_weeks ?? DEFAULT_PRICING_CONFIG.credit_weeks,
        assembly_base: v.assembly_base ?? DEFAULT_PRICING_CONFIG.assembly_base,
        assembly_per_floor: v.assembly_per_floor ?? DEFAULT_PRICING_CONFIG.assembly_per_floor,
        wholesale_factor_mdf: v.wholesale_factor_mdf ?? DEFAULT_PRICING_CONFIG.wholesale_factor_mdf,
        wholesale_factor_blanca: v.wholesale_factor_blanca ?? DEFAULT_PRICING_CONFIG.wholesale_factor_blanca,
        wholesale_factor_color: v.wholesale_factor_color ?? DEFAULT_PRICING_CONFIG.wholesale_factor_color,
        min_margin_alert: v.min_margin_alert ?? DEFAULT_PRICING_CONFIG.min_margin_alert,
      });
    });

    this.simForm.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      this.simValue.set({
        baseCost: v.baseCost ?? null,
        margin: v.margin ?? null,
        material: (v.material as ProductMaterial) ?? 'MDF',
      });
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
