/**
 * Normalización de las imágenes de referencia para el fabricante
 * (Docs/plan-imagen-referencia-fabricante + Docs/plan-fabricacion-y-notas-por-linea).
 * Funciones puras, sin base de datos, igual que pricing.test.js. Ejecutar: npm test
 *
 * Nueva firma: normalize(raw, { keep }) — `keep` lo decide el caller
 * (línea marcada como modificación y no pickup).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const refImages = require('../src/utils/orderRefImages');

const A = '/uploads/order-refs/1700000000000-abc.webp';
const B = '/uploads/order-refs/1700000000001-def.webp';

test('undefined = "no se mandó" → conserva lo que había', () => {
  assert.equal(refImages.normalize(undefined, { keep: true }), undefined);
});

test('keep=false (línea no es modificación) → se descartan', () => {
  assert.equal(refImages.normalize([A], { keep: false }), null);
});

test('keep=true se guardan como JSON, sin duplicados', () => {
  assert.equal(
    refImages.normalize([A, A, B], { keep: true }),
    JSON.stringify([A, B]),
  );
});

test('lista vacía → null', () => {
  assert.equal(refImages.normalize([], { keep: true }), null);
});

test('más de 5 imágenes es 400', () => {
  const many = Array.from({ length: 6 }, (_, i) => `/uploads/order-refs/x${i}.webp`);
  assert.throws(
    () => refImages.normalize(many, { keep: true }),
    (err) => err.statusCode === 400,
  );
});

test('una ruta fuera de order-refs es 400', () => {
  assert.throws(
    () => refImages.normalize(['/uploads/products/hack.webp'], { keep: true }),
    (err) => err.statusCode === 400,
  );
});

test('parse acepta arreglo, cadena JSON y null', () => {
  assert.deepEqual(refImages.parse([A, B]), [A, B]);
  assert.deepEqual(refImages.parse(JSON.stringify([A])), [A]);
  assert.deepEqual(refImages.parse(null), []);
  assert.deepEqual(refImages.parse('no-json'), []);
});

test('removed = las que estaban antes y ya no', () => {
  assert.deepEqual(refImages.removed([A, B], [B]), [A]);
  assert.deepEqual(refImages.removed([A], [A]), []);
});
