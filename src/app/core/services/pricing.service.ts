import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';
import {
  CalculatedPrices,
  CreditQuote,
  DEFAULT_PRICING_CONFIG,
  PricingConfigItem,
  PricingConfigMap,
  ProfitBreakdown,
} from '../models/pricing-config.model';

const EMPTY_PRICES: CalculatedPrices = {
  price_cash: null,
  price_6msi: null,
  price_credit: null,
  price_base_no_iva: null,
  iva_amount: null,
  price_with_iva: null,
  card_commission_amount: null,
  msi_commission_amount: null,
  credit_interest_amount: null,
};

const round2 = (n: number) => Math.round(n * 100) / 100;

@Injectable({ providedIn: 'root' })
export class PricingService {
  private api = inject(ApiService);

  /** Lista de parámetros con metadatos para la pantalla de configuración. */
  getConfig(): Observable<PricingConfigItem[]> {
    return this.api
      .get<{ data: PricingConfigItem[] }>('/admin/pricing-config')
      .pipe(map((r) => r.data));
  }

  updateConfig(values: Partial<PricingConfigMap>): Observable<PricingConfigItem[]> {
    return this.api
      .put<{ data: PricingConfigItem[] }>('/admin/pricing-config', values)
      .pipe(map((r) => r.data));
  }

  /** Convierte la lista de parámetros en un mapa key -> valor. */
  static toMap(items: PricingConfigItem[]): PricingConfigMap {
    const map = { ...DEFAULT_PRICING_CONFIG };
    for (const item of items) map[item.config_key] = item.config_value;
    return map;
  }

  /**
   * Equivalente a CEILING() de Excel: siempre hacia arriba al múltiplo.
   * El toFixed(10) neutraliza el error de coma flotante; sin él un valor como
   * 2289.9999999997 subiría a 2300 en vez de quedarse en 2290.
   */
  static ceilTo(value: number, step: number): number {
    const s = step > 0 ? step : 1;
    return Math.ceil(Number((value / s).toFixed(10))) * s;
  }

  /**
   * Comisiones netas de la terminal, derivadas de las base. La terminal cobra
   * IVA sobre su propia comisión: 2.79% × 1.16 = 3.2364%.
   */
  static netCommissions(config: PricingConfigMap): { iva: number; card: number; msi: number } {
    const iva = config.iva / 100;
    return {
      iva,
      card: (config.card_commission_base / 100) * (1 + iva),
      msi: (config.msi_commission_base / 100) * (1 + iva),
    };
  }

  /**
   * Precios de venta a partir del costo base y el % de ganancia.
   * Espejo exacto de backend/src/utils/pricingCalculator.js → calculatePrices,
   * para mostrar el resultado en vivo dentro del modal de producto. El backend
   * recalcula y es la fuente de verdad al guardar.
   */
  static calculatePrices(
    baseCost: number | null,
    marginPct: number | null,
    config: PricingConfigMap,
  ): CalculatedPrices {
    const C = Number(baseCost);
    const D = Number(marginPct) / 100;

    if (!Number.isFinite(C) || C <= 0 || !Number.isFinite(D) || D >= 1 || D < 0) {
      return { ...EMPTY_PRICES };
    }

    const { iva, card, msi } = PricingService.netCommissions(config);
    const step = config.rounding_step || 10;

    const cashDenom = 1 - card;
    const msiDenom = 1 - card - msi;
    if (cashDenom <= 0 || msiDenom <= 0) return { ...EMPTY_PRICES };

    const G = C / (1 - D);
    const J = G * iva;
    const K = G + J;

    const priceCash = PricingService.ceilTo(K / cashDenom, step);
    const price6msi = PricingService.ceilTo(K / msiDenom, step);

    const interest = config.credit_interest / 100;
    const hasInterest = Number.isFinite(interest) && interest >= 0;
    const interestAmount = hasInterest ? priceCash * interest : null;

    return {
      price_cash: priceCash,
      price_6msi: price6msi,
      price_credit:
        interestAmount === null ? null : PricingService.ceilTo(priceCash + interestAmount, step),
      price_base_no_iva: round2(G),
      iva_amount: round2(J),
      price_with_iva: round2(K),
      card_commission_amount: round2(priceCash * card),
      msi_commission_amount: round2(price6msi * msi),
      credit_interest_amount: interestAmount === null ? null : round2(interestAmount),
    };
  }

  /**
   * Plan de "Crédito Tienda" a partir del total de contado de un pedido.
   * Espejo de pricingCalculator.js → calculateCredit.
   *
   * La cuota semanal redondea al peso superior, así que las N cuotas sumarían
   * más que el saldo; la ÚLTIMA se ajusta para que el cliente pague exactamente
   * el precio a crédito.
   */
  static calculateCredit(
    cashTotal: number | null,
    config: PricingConfigMap,
  ): CreditQuote | null {
    const M = Number(cashTotal);
    if (!Number.isFinite(M) || M <= 0) return null;

    const interest = config.credit_interest / 100;
    const initialPct = config.credit_initial_pct / 100;
    const weeks = Math.max(1, Math.trunc(config.credit_weeks) || 12);
    const step = config.rounding_step || 10;

    if (!Number.isFinite(interest) || interest < 0 || initialPct <= 0 || initialPct >= 1) {
      return null;
    }

    const creditPrice = PricingService.ceilTo(M * (1 + interest), step);
    const downPayment = PricingService.ceilTo(creditPrice * initialPct, 1);
    const balance = creditPrice - downPayment;
    const weeklyPayment = PricingService.ceilTo(balance / weeks, 1);
    const lastPayment = Math.max(0, round2(balance - weeklyPayment * (weeks - 1)));

    return { cashTotal: M, creditPrice, downPayment, weeklyPayment, lastPayment, weeks };
  }

  /**
   * Modo inverso: dado el precio de contado deseado, despeja el margen que lo
   * produce. El margen se trunca hacia abajo para que el CEILING posterior
   * aterrice exactamente en el objetivo y no salte al siguiente múltiplo.
   */
  static marginFromCashPrice(
    baseCost: number | null,
    cashPrice: number | null,
    config: PricingConfigMap,
  ): { marginPercentage: number; targetCashPrice: number } | null {
    const C = Number(baseCost);
    const target = Number(cashPrice);
    if (!Number.isFinite(C) || C <= 0 || !Number.isFinite(target) || target <= 0) return null;

    const { iva, card } = PricingService.netCommissions(config);
    if (1 - card <= 0) return null;

    const targetCashPrice = PricingService.ceilTo(target, config.rounding_step || 10);
    const G = (targetCashPrice * (1 - card)) / (1 + iva);
    if (G <= 0) return null;

    const margin = 1 - C / G;
    if (!Number.isFinite(margin) || margin <= 0 || margin >= 1) return null;

    return {
      marginPercentage: Math.floor(margin * 100 * 10000) / 10000,
      targetCashPrice,
    };
  }

  /**
   * Utilidad que deja un proveedor concreto, por modalidad de pago.
   * La utilidad de 6 MSI descuenta la comisión de tarjeta sobre el precio a
   * 6 MSI (no sobre el de contado, como hacía el Excel).
   */
  static profitByCost(
    cost: number | null,
    prices: CalculatedPrices,
    config: PricingConfigMap,
  ): ProfitBreakdown | null {
    const C = Number(cost);
    if (!Number.isFinite(C) || C <= 0 || prices.price_cash === null) return null;

    const { card, msi } = PricingService.netCommissions(config);
    const O = prices.price_cash;
    const R = prices.price_6msi;
    const T = prices.price_credit;
    const J = prices.iva_amount ?? 0;

    return {
      cash: round2(O - C),
      card: round2(O - C - J - O * card),
      msi: R === null ? null : round2(R - C - J - R * card - R * msi),
      credit: T === null ? null : round2(T - C - J),
      marginPct: round2(((O - C) / O) * 100),
    };
  }
}
