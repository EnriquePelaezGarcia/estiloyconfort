/**
 * Funciones puras de la decisión "¿esta línea / este pedido se fabrica?"
 * (Docs/plan-fabricacion-y-notas-por-linea.md). Sin BD, como pricing.test.js.
 * Ejecutar: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { _internals } = require('../src/models/Order');

const { orderHasFabrication, normalizeLineModification } = _internals;

test('normalizeLineModification: sin bloque → null (no marcada)', () => {
  assert.equal(normalizeLineModification(undefined), null);
  assert.equal(normalizeLineModification(null), null);
  assert.equal(normalizeLineModification('x'), null);
});

test('normalizeLineModification: bloque vacío → marcada, sin nota ni fotos', () => {
  assert.deepEqual(normalizeLineModification({}), { note: null, images: [] });
});

test('normalizeLineModification: recorta la nota a 500 y limpia espacios', () => {
  assert.deepEqual(
    normalizeLineModification({ note: '  patas de plástico  ' }),
    { note: 'patas de plástico', images: [] },
  );
  const long = 'a'.repeat(600);
  assert.equal(normalizeLineModification({ note: long }).note.length, 500);
});

test('normalizeLineModification: valida y deduplica las imágenes', () => {
  const A = '/uploads/order-refs/1700000000000-abc.webp';
  assert.deepEqual(
    normalizeLineModification({ note: 'x', images: [A, A] }),
    { note: 'x', images: [A] },
  );
});

test('normalizeLineModification: imagen con ruta inválida → error', () => {
  assert.throws(() => normalizeLineModification({ images: ['../../etc/passwd'] }));
});

test('orderHasFabrication: alguna línea requiresFabrication', () => {
  assert.equal(orderHasFabrication([{ requiresFabrication: false }, { requiresFabrication: true }], false), true);
});

test('orderHasFabrication: cargo extra aunque ninguna línea la marque', () => {
  assert.equal(orderHasFabrication([{ requiresFabrication: false }], true), true);
});

test('orderHasFabrication: todo stock, sin cargos → false', () => {
  assert.equal(orderHasFabrication([{ requiresFabrication: false }], false), false);
  assert.equal(orderHasFabrication([], false), false);
});
