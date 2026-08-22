/**
 * Fixtures de regresión del motor de precios (D13 del plan de precios por
 * material y mayoreo). Corren sobre funciones PURAS, sin base de datos.
 *
 * Casos tomados literalmente del §8 de REGLAS_NEGOCIO_MUEBLERIA.md.
 * Ejecutar: npm test  (usa node:test, nativo de Node 22, sin dependencias nuevas).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  calculatePrices, calculateCredit, calculateWholesalePrice, profitByCost, wholesaleProfit,
} = require('../src/utils/pricingCalculator');

const CONFIG = {
  iva: 16,
  card_commission_base: 2.79,
  msi_commission_base: 7.69,
  rounding_step: 10,
  credit_interest: 22,
  credit_initial_pct: 35,
  credit_weeks: 12,
};

// M9 del plan de catálogo de materiales: calculateWholesalePrice ya no busca
// el factor por material en CONFIG, lo recibe resuelto. Todos los materiales
// del fixture original usaban 1.334, así que el valor no cambia.
const WHOLESALE_FACTOR = 1.334;

test('Caso 1 — Espejo Vanity / MDF', () => {
  const prices = calculatePrices(1350, 29.3, CONFIG);
  assert.equal(prices.price_cash, 2290);
  assert.equal(prices.price_6msi, 2530);

  const credit = calculateCredit(prices.price_cash, CONFIG);
  assert.equal(credit.creditPrice, 2800);
  assert.equal(credit.downPayment, 980);
  assert.equal(credit.weeklyPayment, 152);

  const wholesale = calculateWholesalePrice(1350, WHOLESALE_FACTOR);
  assert.equal(wholesale, 1801);

  const profitPerrucho = profitByCost(1350, prices, CONFIG);
  assert.equal(profitPerrucho.card, 560.37);
  assert.equal(profitPerrucho.marginPct, 41.05); // sobre costo, no confundir con %ganancia de venta

  const profitCarlos = profitByCost(1100, prices, CONFIG);
  assert.equal(profitCarlos.card, 810.37);

  const creditProfitPerrucho = round2(credit.creditPrice - 1350 - prices.iva_amount);
  assert.equal(creditProfitPerrucho, 1144.48); // RN-14: crédito no descuenta comisión

  const wProfit = wholesaleProfit(1350, wholesale);
  assert.equal(wProfit.profit, 451);
  assert.equal(wProfit.marginPct, 25.04);
});

// El costo 1950 venía de la fórmula del Excel para Melamina Blanca
// (1350 + 600). Ese material se dio de baja el 21-ago-2026, pero el caso se
// conserva tal cual: lo que prueba es la aritmética de precios sobre un
// segundo costo base, y eso no depende de qué material lo produjo.
test('Caso 2 — Espejo Vanity con costo base 1950', () => {
  const prices = calculatePrices(1950, 29.3, CONFIG);
  assert.equal(prices.price_cash, 3310);
  assert.equal(prices.price_6msi, 3650);

  const credit = calculateCredit(prices.price_cash, CONFIG);
  assert.equal(credit.creditPrice, 4040);
  assert.equal(credit.downPayment, 1414);
  assert.equal(credit.weeklyPayment, 219);

  const wholesale = calculateWholesalePrice(1950, WHOLESALE_FACTOR);
  assert.equal(wholesale, 2602);
});

test('RN-15 — utilidad de mayoreo sin IVA ni comisión', () => {
  const wholesale = calculateWholesalePrice(1350, WHOLESALE_FACTOR);
  const profit = wholesaleProfit(1350, wholesale);
  // Ni IVA ni comisión de tarjeta entran aquí: es venta de contado entre negocios.
  assert.equal(profit.profit, wholesale - 1350);
});

test('RN-03 — margen o costo inválido no produce precio negativo, produce null', () => {
  // El caso documentado de "Base" con %ganancia = 239.5% mal capturado.
  const prices = calculatePrices(850, 239.5, CONFIG);
  assert.equal(prices.price_cash, null);
});

test('calculateWholesalePrice — material sin costo (RN-03) devuelve null', () => {
  assert.equal(calculateWholesalePrice(null, WHOLESALE_FACTOR), null);
  assert.equal(calculateWholesalePrice(0, WHOLESALE_FACTOR), null);
});

function round2(n) { return Math.round(n * 100) / 100; }
