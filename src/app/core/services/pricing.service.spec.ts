import { PricingService } from './pricing.service';
import { PricingConfigMap } from '../models/pricing-config.model';

/**
 * Único .spec.ts autorizado del proyecto (D13 del plan de precios por
 * material y mayoreo). No prueba lógica de negocio nueva: prueba que
 * PricingService y backend/src/utils/pricingCalculator.js dan EL MISMO
 * número contra los fixtures del §8 de REGLAS_NEGOCIO_MUEBLERIA.md.
 *
 * Si el backend y el frontend divergen, el vendedor ve un precio en pantalla
 * y el sistema cobra otro. Al tocar pricingCalculator.js o pricing.service.ts,
 * estos fixtures van en el mismo commit (mismas cifras que backend/test/pricing.test.js).
 */
const CONFIG: PricingConfigMap = {
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
};

// M9 del plan de catálogo de materiales: calculateWholesalePrice ya no busca
// el factor por material en CONFIG, lo recibe resuelto. Todos los materiales
// del fixture original usaban 1.334, el valor no cambia.
const WHOLESALE_FACTOR = 1.334;

describe('PricingService — paridad con el backend', () => {
  it('Caso 1 — Espejo Vanity / MDF Pintado', () => {
    const prices = PricingService.calculatePrices(1350, 29.3, CONFIG);
    expect(prices.price_cash).toBe(2290);
    expect(prices.price_6msi).toBe(2530);

    const credit = PricingService.calculateCredit(prices.price_cash, CONFIG);
    expect(credit?.creditPrice).toBe(2800);
    expect(credit?.downPayment).toBe(980);
    expect(credit?.weeklyPayment).toBe(152);

    const wholesale = PricingService.calculateWholesalePrice(1350, WHOLESALE_FACTOR);
    expect(wholesale).toBe(1801);

    const profitPerrucho = PricingService.profitByCost(1350, prices, CONFIG);
    expect(profitPerrucho?.card).toBe(560.37);

    const profitCarlos = PricingService.profitByCost(1100, prices, CONFIG);
    expect(profitCarlos?.card).toBe(810.37);

    const wProfit = PricingService.wholesaleProfit(1350, wholesale);
    expect(wProfit?.profit).toBe(451);
    expect(wProfit?.marginPct).toBe(25.04);
  });

  it('Caso 2 — Espejo Vanity / Melamina Blanca (costoBase = costo + 600)', () => {
    const prices = PricingService.calculatePrices(1950, 29.3, CONFIG);
    expect(prices.price_cash).toBe(3310);
    expect(prices.price_6msi).toBe(3650);

    const credit = PricingService.calculateCredit(prices.price_cash, CONFIG);
    expect(credit?.creditPrice).toBe(4040);
    expect(credit?.downPayment).toBe(1414);
    expect(credit?.weeklyPayment).toBe(219);

    const wholesale = PricingService.calculateWholesalePrice(1950, WHOLESALE_FACTOR);
    expect(wholesale).toBe(2602);
  });

  it('RN-15 — utilidad de mayoreo sin IVA ni comisión', () => {
    const wholesale = PricingService.calculateWholesalePrice(1350, WHOLESALE_FACTOR);
    const profit = PricingService.wholesaleProfit(1350, wholesale);
    expect(profit?.profit).toBe((wholesale ?? 0) - 1350);
  });

  it('RN-03 — margen inválido no produce precio negativo, produce null', () => {
    const prices = PricingService.calculatePrices(850, 239.5, CONFIG);
    expect(prices.price_cash).toBeNull();
  });

  it('calculateWholesalePrice — material sin costo (RN-03) devuelve null', () => {
    expect(PricingService.calculateWholesalePrice(null, WHOLESALE_FACTOR)).toBeNull();
    expect(PricingService.calculateWholesalePrice(0, WHOLESALE_FACTOR)).toBeNull();
  });
});
