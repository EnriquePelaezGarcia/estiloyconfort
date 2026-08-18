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
import { MaterialsStore } from '../../../core/services/materials.store';
import { CurrencyInputDirective } from '../../../shared/directives/currency-input.directive';

@Component({
  selector: 'app-admin-pricing',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pricing.component.html',
  styleUrl: './pricing.component.scss',
  imports: [ReactiveFormsModule, CurrencyInputDirective],
})
export class PricingComponent implements OnInit {
  private pricingService = inject(PricingService);
  private notification = inject(NotificationService);
  private fb = inject(FormBuilder);
  private materialsStore = inject(MaterialsStore);

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
    // M9 — un solo factor global; cada material puede tener el suyo en
    // *Admin → Materiales*. M11-M13 — el módulo de Mayoreo.
    wholesale_factor_default: [DEFAULT_PRICING_CONFIG.wholesale_factor_default, [Validators.required, Validators.min(0.01)]],
    wholesale_enabled: [DEFAULT_PRICING_CONFIG.wholesale_enabled],
    wholesale_min_qty: [DEFAULT_PRICING_CONFIG.wholesale_min_qty, [Validators.required, Validators.min(1)]],
    wholesale_price_includes_iva: [DEFAULT_PRICING_CONFIG.wholesale_price_includes_iva],
    min_margin_alert: [DEFAULT_PRICING_CONFIG.min_margin_alert, [Validators.required, Validators.min(0), Validators.max(100)]],
    // Plazo de fabricación, uno solo para todo el catálogo
    // (Docs/plan-disponibilidad-publica.md). min(1): un plazo de 0 días haría
    // que el POS prometiera la pieza para hoy en algo que ni se ha empezado.
    fabrication_days: [DEFAULT_PRICING_CONFIG.fabrication_days, [Validators.required, Validators.min(1), Validators.max(365)]],
    // Docs/plan-descuentos.md RN-D4 — tope de vendedor/repartidor; el admin no tiene tope.
    max_seller_discount: [DEFAULT_PRICING_CONFIG.max_seller_discount, [Validators.required, Validators.min(0)]],
  });

  protected readonly materials = this.materialsStore.active;

  // ===== Simulador en vivo =====
  protected simForm = this.fb.group({
    baseCost: [1350 as number | null],
    margin: [29.3 as number | null],
    materialId: [null as number | null],
  });

  private formValue = signal<PricingConfigMap>({ ...DEFAULT_PRICING_CONFIG });
  private simValue = signal<{ baseCost: number | null; margin: number | null; materialId: number | null }>({
    baseCost: 1350,
    margin: 29.3,
    materialId: null,
  });

  protected simResult = computed(() =>
    PricingService.calculatePrices(this.simValue().baseCost, this.simValue().margin, this.formValue()),
  );

  /**
   * RN-10 — precio de mayoreo simulado: directo sobre el costo, sin margen
   * ni IVA. El factor es el del material elegido (si tiene el suyo, M9) o el
   * default global; sin material elegido usa directo el default.
   */
  protected simWholesale = computed(() => {
    const materialId = this.simValue().materialId;
    const material = materialId != null ? this.materialsStore.byId().get(materialId) : null;
    const factor = material?.wholesaleFactor ?? this.formValue().wholesale_factor_default;
    return PricingService.calculateWholesalePrice(this.simValue().baseCost, factor);
  });

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
        wholesale_factor_default: v.wholesale_factor_default ?? DEFAULT_PRICING_CONFIG.wholesale_factor_default,
        wholesale_enabled: v.wholesale_enabled ? 1 : 0,
        wholesale_min_qty: v.wholesale_min_qty ?? DEFAULT_PRICING_CONFIG.wholesale_min_qty,
        wholesale_price_includes_iva: v.wholesale_price_includes_iva ? 1 : 0,
        min_margin_alert: v.min_margin_alert ?? DEFAULT_PRICING_CONFIG.min_margin_alert,
        fabrication_days: v.fabrication_days ?? DEFAULT_PRICING_CONFIG.fabrication_days,
        max_seller_discount: v.max_seller_discount ?? DEFAULT_PRICING_CONFIG.max_seller_discount,
      });
    });

    this.simForm.valueChanges.pipe(takeUntilDestroyed()).subscribe((v) => {
      this.simValue.set({
        baseCost: v.baseCost ?? null,
        margin: v.margin ?? null,
        materialId: v.materialId ?? null,
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
