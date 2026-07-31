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
  | 'assembly_per_floor';

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

/** Utilidad que deja un proveedor concreto, por modalidad de pago. */
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

/** Parámetros del crédito en tienda que consume el Punto de Venta. */
export interface CreditConfig {
  creditInterest: number;
  creditInitialPct: number;
  creditWeeks: number;
  roundingStep: number;
}
