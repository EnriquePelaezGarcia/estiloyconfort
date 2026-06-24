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
  | 'rounding_step';

/** Mapa key -> valor usado por el calculador de precios. */
export type PricingConfigMap = Record<PricingConfigKey, number>;

export const DEFAULT_PRICING_CONFIG: PricingConfigMap = {
  iva: 16,
  card_commission: 3.2364,
  msi_commission: 8.9204,
  rounding_step: 10,
};

export interface CalculatedPrices {
  price_cash: number | null;
  price_6msi: number | null;
}
