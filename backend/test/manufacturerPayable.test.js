/**
 * Regla de devengo de una orden de compra en cuentas por pagar
 * (Docs/plan-oc-cuentas-por-pagar-devengo-anticipo.md, Fase A). Sin BD, como
 * pricing.test.js: prueba el espejo en JS de la rama `purchase_order` del
 * `DOCUMENTS_CTE` — si cambia el CASE del SQL, hay que cambiar los dos.
 * Ejecutar: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { _internals } = require('../src/models/ManufacturerPayable');

const { poPayableAccrual } = _internals;

const base = {
  status: 'sent',
  acceptanceStatus: 'pending',
  totalCost: 5000,
  receivedDate: null,
  acceptanceReviewedAt: null,
};

test('OC en borrador → no devenga', () => {
  assert.deepEqual(
    poPayableAccrual({ ...base, status: 'draft' }),
    { amount: 0, accrualDate: null },
  );
});

test('OC enviada pero sin aceptar → no devenga', () => {
  assert.deepEqual(
    poPayableAccrual({ ...base, status: 'sent', acceptanceStatus: 'pending' }),
    { amount: 0, accrualDate: null },
  );
});

test('OC enviada y RECHAZADA → no devenga', () => {
  assert.deepEqual(
    poPayableAccrual({ ...base, acceptanceStatus: 'rejected' }),
    { amount: 0, accrualDate: null },
  );
});

test('OC aceptada (no recibida) → devenga total_cost en la fecha de aceptación', () => {
  assert.deepEqual(
    poPayableAccrual({
      ...base,
      status: 'sent',
      acceptanceStatus: 'accepted',
      acceptanceReviewedAt: '2026-09-10T14:30:00.000Z',
    }),
    { amount: 5000, accrualDate: '2026-09-10' },
  );
});

test('OC aceptada en producción → sigue devengando por la aceptación', () => {
  assert.deepEqual(
    poPayableAccrual({
      ...base,
      status: 'in_production',
      acceptanceStatus: 'accepted',
      acceptanceReviewedAt: '2026-08-01 09:00:00',
    }),
    { amount: 5000, accrualDate: '2026-08-01' },
  );
});

test('OC recibida y aceptada → la recepción manda: fecha = received_date (no la de aceptación)', () => {
  assert.deepEqual(
    poPayableAccrual({
      ...base,
      status: 'received',
      acceptanceStatus: 'accepted',
      acceptanceReviewedAt: '2026-08-01',
      receivedDate: '2026-09-05',
    }),
    { amount: 5000, accrualDate: '2026-09-05' },
  );
});

test('OC recibida SIN aceptar (fabricante sin portal) → devenga igual, sin regresión', () => {
  assert.deepEqual(
    poPayableAccrual({
      ...base,
      status: 'received',
      acceptanceStatus: 'pending',
      receivedDate: '2026-09-05',
    }),
    { amount: 5000, accrualDate: '2026-09-05' },
  );
});

test('OC cancelada → nunca cuenta, aunque estuviera aceptada', () => {
  assert.deepEqual(
    poPayableAccrual({
      ...base,
      status: 'cancelled',
      acceptanceStatus: 'accepted',
      acceptanceReviewedAt: '2026-09-01',
    }),
    { amount: 0, accrualDate: null },
  );
});

test('total_cost ausente o basura → 0', () => {
  assert.equal(poPayableAccrual({ ...base, status: 'received', totalCost: null }).amount, 0);
  assert.equal(poPayableAccrual({ ...base, status: 'received', totalCost: undefined }).amount, 0);
});
