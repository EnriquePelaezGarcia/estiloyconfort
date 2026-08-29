-- =====================================================================
-- Mueblería Estilo y Confort — Talla como eje de precio (Fase 1)
--   Docs/plan-productos-por-tamano.md — D1, D2.
--
-- Catálogo de tallas (Individual / Matrimonial / King) + declaración de
-- tallas por producto. La talla es OPT-IN: un producto sin filas en
-- `product_sizes` es un producto "sin talla" y su flujo actual NO cambia.
--
-- 🟢 ADITIVA y REPETIBLE: solo CREATE TABLE IF NOT EXISTS + INSERT ...
-- ON DUPLICATE KEY UPDATE. Cero backfill: ningún producto gana tallas.
--
-- SIN `USE`: run-schema.js ya selecciona DB_NAME (staging/prod no se llaman
-- estilo_confort).
--
-- Ejecutar: node src/database/run-schema.js schema_sizes.sql
-- =====================================================================

-- ─── 1. Catálogo de tallas (D1) ─────────────────────────────────────────────
-- Lista fija de 3 (sin pantalla de CRUD en esta entrega). Es tabla y no ENUM
-- por integridad referencial y para congelar `size_label` en pedidos, igual
-- que `materials`. `code` es legible por humanos (seed, tests); las FK usan `id`.
CREATE TABLE IF NOT EXISTS sizes (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  code       VARCHAR(40)  NOT NULL UNIQUE,
  label      VARCHAR(80)  NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO sizes (code, label, sort_order) VALUES
  ('INDIVIDUAL',  'Individual',  1),
  ('MATRIMONIAL', 'Matrimonial', 2),
  ('KING',        'King Size',   3)
ON DUPLICATE KEY UPDATE label = VALUES(label), sort_order = VALUES(sort_order);

-- ─── 2. Declaración de tallas por producto (D2) ─────────────────────────────
-- "Este producto se vende en estas tallas" — casillas marcadas a mano en el
-- alta, igual que product_materials declara materiales. Sin filas = sin talla.
CREATE TABLE IF NOT EXISTS product_sizes (
  product_id INT NOT NULL,
  size_id    INT NOT NULL,
  is_active  BOOLEAN NOT NULL DEFAULT TRUE,
  PRIMARY KEY (product_id, size_id),
  FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
  FOREIGN KEY (size_id)    REFERENCES sizes(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
