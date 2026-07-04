/** Fila de tarifa de envío por rango de código postal. */
export interface ShippingRate {
  id: number;
  city: string;
  zone: string;
  rangeStart: number;
  rangeEnd: number;
  price: number;
  label: string;
}

/** Resultado de cotizar el envío para un código postal. */
export interface ShippingQuote {
  cp: string;
  price: number;
  zone: string;
  label: string;
  isFree: boolean;
}
