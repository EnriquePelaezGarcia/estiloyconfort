/** Una regla de precio configurable (parámetro global). */
export interface PricingConfigItem {
  config_key: PricingConfigKey;
  config_value: number;
  label: string;
  description: string | null;
  unit: string;
  order_display: number;
}

export type PricingConfigKey =
  | 'iva'
  // Comisiones BASE de la terminal. Las netas no se almacenan: se derivan
  // multiplicando por (1 + IVA), porque la terminal cobra IVA sobre su propia
  // comisión. Ver PricingService.netCommissions().
  | 'card_commission_base'
  | 'msi_commission_base'
  | 'rounding_step'
  | 'credit_interest'
  | 'credit_initial_pct'
  | 'credit_weeks'
  | 'assembly_base'
  | 'assembly_per_floor'
  // M9 del plan de catálogo de materiales: un único factor global; cada
  // material puede tener el suyo propio en materials.wholesaleFactor.
  | 'wholesale_factor_default'
  // M11: booleano (0/1) — con esto en 0 el mayoreo no aparece en POS ni
  // reportes, aunque price_mayoreo se sigue calculando en todo el catálogo.
  | 'wholesale_enabled'
  // M12 — mínimo global; products.wholesaleMinQty lo puede sobreescribir.
  | 'wholesale_min_qty'
  // M13: booleano (0/1). En 0 (default) el precio de mayoreo es SIN IVA y se
  // suma al facturar.
  | 'wholesale_price_includes_iva'
  // Umbral visual del semáforo de utilidades. No bloquea nada.
  | 'min_margin_alert'
  // Plazo de fabricación en días HÁBILES cuando un mueble no tiene existencia
  // (Docs/plan-disponibilidad-publica.md). Uno solo para todo el catálogo.
  // Solo lo ve el vendedor; el cliente ve "Sobre pedido", sin plazos.
  | 'fabrication_days'
  // Tope de descuento en dinero para vendedor/repartidor sin pasar por un
  // admin (Docs/plan-descuentos.md RN-D4). El admin no tiene tope.
  | 'max_seller_discount';

/** Mapa key -> valor usado por el calculador de precios. */
export type PricingConfigMap = Record<PricingConfigKey, number>;

export const DEFAULT_PRICING_CONFIG: PricingConfigMap = {
  iva: 16,
  card_commission_base: 2.79,
  msi_commission_base: 7.69,
  rounding_step: 10,
  credit_interest: 22,
  credit_initial_pct: 35,
  credit_weeks: 12,
  assembly_base: 150,
  assembly_per_floor: 50,
  wholesale_factor_default: 1.334,
  wholesale_enabled: 0,
  wholesale_min_qty: 6,
  wholesale_price_includes_iva: 0,
  min_margin_alert: 20,
  fabrication_days: 15,
  max_seller_discount: 2000,
};

export interface CalculatedPrices {
  price_cash: number | null;
  price_6msi: number | null;
  price_credit: number | null;
  /** Desglose de auditoría (G, J, K y comisiones absorbidas). */
  price_base_no_iva: number | null;
  iva_amount: number | null;
  price_with_iva: number | null;
  card_commission_amount: number | null;
  msi_commission_amount: number | null;
  credit_interest_amount: number | null;
}

/** Utilidad que deja un fabricante concreto, por modalidad de pago. */
export interface ProfitBreakdown {
  cash: number;
  card: number;
  msi: number | null;
  credit: number | null;
  marginPct: number;
}

/** Desglose del plan de financiamiento "Crédito Tienda". */
export interface CreditQuote {
  /** Total de contado (base sin interés). */
  cashTotal: number;
  /** Precio a crédito (contado + interés, redondeado). */
  creditPrice: number;
  /** Pago inicial obligatorio. */
  downPayment: number;
  /** Cuota semanal de los primeros (weeks - 1) abonos. */
  weeklyPayment: number;
  /**
   * Último abono, ajustado para que el total cobrado sea exactamente
   * creditPrice. La cuota semanal redondea al peso superior, así que sin este
   * ajuste las N cuotas sumarían de más.
   */
  lastPayment: number;
  /** Número de abonos semanales. */
  weeks: number;
}

/**
 * Parámetros del crédito en tienda y de Mayoreo (M11-M13) que consume el
 * Punto de Venta y el ticket — es el subconjunto de `pricing_config`
 * accesible a vendedor (no solo admin).
 */
export interface CreditConfig {
  creditInterest: number;
  creditInitialPct: number;
  creditWeeks: number;
  roundingStep: number;
  iva: number;
  /** M11 — con esto en false, "Mayoreo" no aparece como condición de venta. */
  wholesaleEnabled: boolean;
  /** M12 — mínimo global (products.wholesaleMinQty lo puede sobreescribir). */
  wholesaleMinQty: number;
  /** M13 — false (default): el precio de mayoreo es SIN IVA y se suma al facturar. */
  wholesalePriceIncludesIva: boolean;
  /**
   * Días HÁBILES de fabricación cuando la línea no tiene existencia
   * (Docs/plan-disponibilidad-publica.md). El POS lo convierte en fecha
   * estimada; nunca se le muestra al cliente en el catálogo.
   */
  fabricationDays: number;
  /** Docs/plan-descuentos.md RN-D4 — tope de descuento en dinero sin admin. */
  maxSellerDiscount: number;
}
