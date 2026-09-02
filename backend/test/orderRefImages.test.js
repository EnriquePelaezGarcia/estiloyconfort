/**
 * Normalización de las imágenes de referencia para el fabricante
 * (Docs/plan-imagen-referencia-fabricante). Funciones puras, sin base de datos,
 * igual que pricing.test.js. Ejecutar: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const refImages = require('../src/utils/orderRefImages');

const A = '/uploads/order-refs/1700000000000-abc.webp';
const B = '/uploads/order-refs/1700000000001-def.webp';

test('undefined = "no se mandó" → conserva lo que había', () => {
  assert.equal(
    refImages.normalize(undefined, { notasFabricante: 'cambiar patas', pickupInStore: false }),
    undefined,
  );
});

test('sin notas para el fabricante se descartan', () => {
  assert.equal(
    refImages.normalize([A], { notasFabricante: '   ', pickupInStore: false }),
    null,
  );
});

test('recoge en tienda se descartan', () => {
  assert.equal(
    refImages.normalize([A], { notasFabricante: 'nota', pickupInStore: true }),
    null,
  );
});

test('con notas se guardan como JSON, sin duplicados', () => {
  assert.equal(
    refImages.normalize([A, A, B], { notasFabricante: 'nota', pickupInStore: false }),
    JSON.stringify([A, B]),
  );
});

test('lista vacía → null', () => {
  assert.equal(
    refImages.normalize([], { notasFabricante: 'nota', pickupInStore: false }),
    null,
  );
});

test('más de 5 imágenes es 400', () => {
  const many = Array.from({ length: 6 }, (_, i) => `/uploads/order-refs/x${i}.webp`);
  assert.throws(
    () => refImages.normalize(many, { notasFabricante: 'nota', pickupInStore: false }),
    (err) => err.statusCode === 400,
  );
});

test('una ruta fuera de order-refs es 400', () => {
  assert.throws(
    () => refImages.normalize(['/uploads/products/hack.webp'], { notasFabricante: 'nota', pickupInStore: false }),
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
