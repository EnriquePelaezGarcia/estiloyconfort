/**
 * Motor de precios — implementa ESPEC_CALCULADORA_PRECIOS.md.
 *
 * Cadena de cálculo (C = costo base, D = margen en fracción):
 *   G = C / (1 - D)                                        Precio sin IVA
 *   J = G * iva                                            Monto de IVA
 *   K = G + J                                              Precio con IVA (base de comisiones)
 *   O = CEILING(K / (1 - comTarjeta), paso)                Precio de contado
 *   R = CEILING(K / (1 - comTarjeta - comMSI), paso)       Precio a 6 MSI
 *   T = CEILING(O + O * interes, paso)                     Precio a crédito
 *
 * El margen es sobre el PRECIO, no sobre el costo: C/(1-D), nunca C*(1+D).
 * Las comisiones se absorben (gross-up): el cliente paga O y, tras el descuento
 * de la terminal, a la tienda le quedan exactamente K pesos.
 *
 * El precio de mayoreo del Excel (columna N) queda fuera de alcance a propósito.
 */

/**
 * Equivalente a CEILING() de Excel: redondea siempre hacia arriba al múltiplo.
 * El toFixed(10) neutraliza el error de coma flotante; sin él un valor como
 * 2289.9999999997 subiría a 2300 en vez de quedarse en 2290.
 */
const ceilTo = (value, step) => {
  const s = Number(step) > 0 ? Number(step) : 1;
  return Math.ceil(Number((value / s).toFixed(10))) * s;
};

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Resuelve las tasas efectivas a partir de la configuración global.
 *
 * Las comisiones netas NO se almacenan: se derivan de las base, porque la
 * terminal cobra IVA sobre su propia comisión (2.79% * 1.16 = 3.2364%).
 * Guardar ambas por separado deja el sistema inconsistente al cambiar tarifa.
 *
 * Se acepta la forma antigua (comisión neta directa) como respaldo para bases
 * de datos donde aún no corrió la migración schema_pricing_v2.sql.
 */
function resolveRates(config) {
  const iva = Number(config.iva) / 100;
  const cardBase = config.card_commission_base;
  const msiBase = config.msi_commission_base;

  return {
    iva,
    card: cardBase != null
      ? (Number(cardBase) / 100) * (1 + iva)
      : Number(config.card_commission) / 100,
    msi: msiBase != null
      ? (Number(msiBase) / 100) * (1 + iva)
      : Number(config.msi_commission) / 100,
    step: Number(config.rounding_step) || 10,
  };
}

const EMPTY_PRICES = {
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

/**
 * @param {number} baseCost  Costo base del producto (el MÁXIMO de sus fabricantes)
 * @param {number} marginPct Margen de ganancia en porcentaje (29.3 = 29.3%)
 * @param {object} config    Parámetros globales de pricing_config
 * @returns {typeof EMPTY_PRICES} Precios de venta más el desglose de auditoría.
 */
function calculatePrices(baseCost, marginPct, config) {
  const C = Number(baseCost);
  const D = Number(marginPct) / 100;

  // Sin costo válido o con margen >= 100% el cálculo no tiene sentido.
  if (!Number.isFinite(C) || C <= 0 || !Number.isFinite(D) || D >= 1 || D < 0) {
    return { ...EMPTY_PRICES };
  }

  const { iva, card, msi, step } = resolveRates(config);

  const cashDenom = 1 - card;
  const msiDenom = 1 - card - msi;
  if (cashDenom <= 0 || msiDenom <= 0) return { ...EMPTY_PRICES };

  const G = C / (1 - D);
  const J = G * iva;
  const K = G + J;

  const priceCash = ceilTo(K / cashDenom, step);
  const price6msi = ceilTo(K / msiDenom, step);

  const interest = Number(config.credit_interest) / 100;
  const hasInterest = Number.isFinite(interest) && interest >= 0;
  const interestAmount = hasInterest ? priceCash * interest : null;
  const priceCredit = hasInterest ? ceilTo(priceCash + interestAmount, step) : null;

  return {
    price_cash: priceCash,
    price_6msi: price6msi,
    price_credit: priceCredit,
    price_base_no_iva: round2(G),
    iva_amount: round2(J),
    price_with_iva: round2(K),
    card_commission_amount: round2(priceCash * card),
    msi_commission_amount: round2(price6msi * msi),
    credit_interest_amount: interestAmount === null ? null : round2(interestAmount),
  };
}

/**
 * Plan de financiamiento "Crédito Tienda" sobre el total de contado de un pedido.
 *
 *   T = CEILING(M * (1 + interes), paso)   Precio a crédito
 *   U = CEILING(T * inicial, 1)            Enganche
 *   V = CEILING((T - U) / N, 1)            Cuota semanal
 *
 * Como V redondea al peso superior, las N cuotas suman más que el saldo. La
 * ÚLTIMA cuota absorbe la diferencia para que el cliente pague exactamente T:
 * se cobran (N-1) cuotas de V y una final de lastPayment.
 *
 * @returns {{cashTotal:number, creditPrice:number, downPayment:number,
 *            weeklyPayment:number, lastPayment:number, weeks:number}|null}
 */
function calculateCredit(cashTotal, config) {
  const M = Number(cashTotal);
  if (!Number.isFinite(M) || M <= 0) return null;

  const interest = Number(config.credit_interest) / 100;
  const initialPct = Number(config.credit_initial_pct) / 100;
  const weeks = Math.max(1, Math.trunc(Number(config.credit_weeks)) || 12);
  const { step } = resolveRates(config);

  if (
    !Number.isFinite(interest) || interest < 0 ||
    !Number.isFinite(initialPct) || initialPct <= 0 || initialPct >= 1
  ) {
    return null;
  }

  const creditPrice = ceilTo(M * (1 + interest), step);
  const downPayment = ceilTo(creditPrice * initialPct, 1);
  const balance = creditPrice - downPayment;
  const weeklyPayment = ceilTo(balance / weeks, 1);

  // Con saldos muy pequeños el redondeo al peso puede consumir el saldo antes
  // de la última semana; en ese caso la última cuota es cero, nunca negativa.
  const lastPayment = Math.max(0, round2(balance - weeklyPayment * (weeks - 1)));

  return { cashTotal: M, creditPrice, downPayment, weeklyPayment, lastPayment, weeks };
}

/**
 * Modo inverso: dado el precio de contado que se quiere alcanzar, despeja el
 * margen que lo produce.
 *
 *   K = O * (1 - comTarjeta)      Precio con IVA antes de comisión
 *   G = K / (1 + iva)             Precio sin IVA
 *   D = 1 - C / G                 Margen de contribución
 *
 * El margen se trunca hacia ABAJO a 4 decimales (no se redondea): un margen
 * ligeramente mayor produciría un precio por encima del objetivo y el CEILING
 * posterior saltaría al siguiente múltiplo. Truncando, el precio recalculado
 * queda apenas por debajo y el CEILING aterriza exactamente en el objetivo.
 *
 * @returns {{marginPercentage:number, targetCashPrice:number}|null}
 */
function marginFromCashPrice(baseCost, cashPrice, config) {
  const C = Number(baseCost);
  const target = Number(cashPrice);
  if (!Number.isFinite(C) || C <= 0 || !Number.isFinite(target) || target <= 0) return null;

  const { iva, card, step } = resolveRates(config);
  if (1 - card <= 0) return null;

  // El objetivo debe ser múltiplo del paso de redondeo; si no, el CEILING nunca
  // podría aterrizar en él.
  const targetCashPrice = ceilTo(target, step);

  const K = targetCashPrice * (1 - card);
  const G = K / (1 + iva);
  if (G <= 0) return null;

  const margin = 1 - C / G;
  if (!Number.isFinite(margin) || margin <= 0 || margin >= 1) return null;

  return {
    marginPercentage: Math.floor(margin * 100 * 10000) / 10000,
    targetCashPrice,
  };
}

/**
 * Utilidad que deja un fabricante concreto, por modalidad de pago.
 * Corresponde a las columnas W–AD del Excel.
 *
 * OJO: la utilidad de 6 MSI descuenta la comisión de tarjeta sobre el PRECIO A
 * 6 MSI, no sobre el de contado. El Excel usa el de contado y por eso
 * sobreestima esa utilidad; aquí se calcula bien.
 *
 * @param {number} cost   Costo de ese fabricante
 * @param {object} prices Resultado de calculatePrices()
 */
function profitByCost(cost, prices, config) {
  const C = Number(cost);
  if (!Number.isFinite(C) || C <= 0 || !prices || prices.price_cash == null) return null;

  const { card, msi } = resolveRates(config);
  const O = prices.price_cash;
  const R = prices.price_6msi;
  const T = prices.price_credit;
  const J = prices.iva_amount ?? 0;

  return {
    cash: round2(O - C),
    card: round2(O - C - J - O * card),
    msi: R == null ? null : round2(R - C - J - R * card - R * msi),
    credit: T == null ? null : round2(T - C - J),
    marginPct: round2(((O - C) / O) * 100),
  };
}

module.exports = {
  calculatePrices,
  calculateCredit,
  marginFromCashPrice,
  profitByCost,
  ceilTo,
};
