/**
 * Cálculo de precios de venta a partir del costo del proveedor y el % de
 * ganancia, según la especificación de Reglas de Precios.
 *
 * Flujo (ver Reglas_Precios_Muebleria.md):
 *   E = C / (1 - D)            Precio base sin IVA (D = margen en fracción)
 *   I = E * (1 + IVA)          Precio con IVA (base para comisiones)
 *   M = CEILING(I / (1 - cTarjeta), paso)              Precio de contado
 *   P = CEILING(I / (1 - cTarjeta - cMSI), paso)       Precio a 6 MSI
 *
 * Las comisiones absorben el costo de la transacción: el cliente paga M o P y
 * la tienda retiene I tras descontar la comisión correspondiente.
 */

const ceilTo = (value, step) => {
  const s = step > 0 ? step : 1;
  return Math.ceil(value / s) * s;
};

/**
 * @param {number} baseCost  Costo del proveedor (C)
 * @param {number} marginPct Margen de ganancia deseado en porcentaje (D)
 * @param {{iva:number, card_commission:number, msi_commission:number, rounding_step:number}} config
 *        Parámetros globales expresados como porcentajes (rounding_step en pesos).
 * @returns {{ price_cash: number|null, price_6msi: number|null }}
 */
function calculatePrices(baseCost, marginPct, config) {
  const C = Number(baseCost);
  const D = Number(marginPct) / 100;

  // Sin costo válido o margen >= 100% el cálculo no tiene sentido.
  if (!Number.isFinite(C) || C <= 0 || !Number.isFinite(D) || D >= 1 || D < 0) {
    return { price_cash: null, price_6msi: null };
  }

  const iva = Number(config.iva) / 100;
  const card = Number(config.card_commission) / 100;
  const msi = Number(config.msi_commission) / 100;
  const step = Number(config.rounding_step) || 10;

  const E = C / (1 - D);
  const I = E * (1 + iva);

  const cashDenom = 1 - card;
  const msiDenom = 1 - card - msi;
  if (cashDenom <= 0 || msiDenom <= 0) {
    return { price_cash: null, price_6msi: null };
  }

  return {
    price_cash: ceilTo(I / cashDenom, step),
    price_6msi: ceilTo(I / msiDenom, step),
  };
}

/**
 * Calcula el plan de financiamiento "Crédito Tienda" a partir del total de
 * contado de un pedido, según la especificación de Reglas de Precios:
 *
 *   Q = M * interes            Interés sobre el precio de contado
 *   R = CEILING(M + Q, paso)   Precio a crédito (redondeo a la decena)
 *   S = CEILING(R * inicial, 1) Pago inicial (35% del precio a crédito)
 *   T = CEILING((R - S) / N, 1) Cuota semanal sobre el saldo
 *
 * @param {number} cashTotal Total de contado del pedido (suma de precios M).
 * @param {{credit_interest:number, credit_initial_pct:number, credit_weeks:number, rounding_step:number}} config
 *        Parámetros globales (interés e inicial en %, semanas y paso de redondeo).
 * @returns {{ cashTotal:number, creditPrice:number, downPayment:number, weeklyPayment:number, weeks:number }|null}
 */
function calculateCredit(cashTotal, config) {
  const M = Number(cashTotal);
  if (!Number.isFinite(M) || M <= 0) return null;

  const interest = Number(config.credit_interest) / 100;
  const initialPct = Number(config.credit_initial_pct) / 100;
  const weeks = Math.max(1, Math.trunc(Number(config.credit_weeks)) || 12);
  const step = Number(config.rounding_step) || 10;

  if (!Number.isFinite(interest) || interest < 0 || !Number.isFinite(initialPct) || initialPct <= 0 || initialPct >= 1) {
    return null;
  }

  const creditPrice = ceilTo(M * (1 + interest), step);
  const downPayment = ceilTo(creditPrice * initialPct, 1);
  const weeklyPayment = ceilTo((creditPrice - downPayment) / weeks, 1);

  return { cashTotal: M, creditPrice, downPayment, weeklyPayment, weeks };
}

module.exports = { calculatePrices, calculateCredit, ceilTo };
