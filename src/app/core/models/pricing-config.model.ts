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
  | 'card_commission'
  | 'msi_commission'
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
  card_commission: 3.2364,
  msi_commission: 8.9204,
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
}

/** Desglose del plan de financiamiento "Crédito Tienda". */
export interface CreditQuote {
  /** Total de contado (base sin interés). */
  cashTotal: number;
  /** Precio a crédito (contado + interés, redondeado). */
  creditPrice: number;
  /** Pago inicial obligatorio. */
  downPayment: number;
  /** Cuota semanal. */
  weeklyPayment: number;
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
