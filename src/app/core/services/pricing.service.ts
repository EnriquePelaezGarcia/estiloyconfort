import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { ApiService } from './api.service';
import {
  CalculatedPrices,
  DEFAULT_PRICING_CONFIG,
  PricingConfigItem,
  PricingConfigMap,
} from '../models/pricing-config.model';

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
   * Calcula precio de contado y a 6 MSI a partir del costo del proveedor y el
   * % de ganancia. Espejo de backend/src/utils/pricingCalculator.js para
   * mostrar el resultado en vivo dentro del modal de producto.
   */
  static calculatePrices(
    baseCost: number | null,
    marginPct: number | null,
    config: PricingConfigMap,
  ): CalculatedPrices {
    const C = Number(baseCost);
    const D = Number(marginPct) / 100;

    if (!Number.isFinite(C) || C <= 0 || !Number.isFinite(D) || D >= 1 || D < 0) {
      return { price_cash: null, price_6msi: null };
    }

    const iva = config.iva / 100;
    const card = config.card_commission / 100;
    const msi = config.msi_commission / 100;
    const step = config.rounding_step || 10;

    const E = C / (1 - D);
    const I = E * (1 + iva);

    const cashDenom = 1 - card;
    const msiDenom = 1 - card - msi;
    if (cashDenom <= 0 || msiDenom <= 0) {
      return { price_cash: null, price_6msi: null };
    }

    const ceilTo = (value: number, s: number) => Math.ceil(value / s) * s;

    return {
      price_cash: ceilTo(I / cashDenom, step),
      price_6msi: ceilTo(I / msiDenom, step),
    };
  }
}
