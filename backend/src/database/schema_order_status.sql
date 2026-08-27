-- =====================================================================
-- Mueblería Estilo y Confort — Migración: estatus "En bodega" (in_warehouse)
--
-- Plan: Docs/plan-rastreo-pedido-cliente.md — Parte A, Hueco 2.
-- Separa el hecho físico ("el mueble está en bodega") del candado de pago
-- ("ya se puede programar la entrega"). Nuevo valor del ENUM entre
-- 'fabricating' y 'ready'.
--
-- REPETIBLE: `MODIFY COLUMN` al mismo tipo es inofensivo re-aplicado.
--
-- Orden de despliegue (por ambiente, local → preprod → prod):
--   1. node src/database/run-schema.js schema_order_status.sql   ← este archivo
--   2. node src/database/backfill_in_warehouse.js
--   3. node src/database/run-schema.js schema_order_status_history.sql   (Parte B)
--   4. node src/database/backfill_order_status_history.js                (Parte B)
--
-- Ejecutar: node src/database/run-schema.js schema_order_status.sql
-- =====================================================================

ALTER TABLE orders MODIFY COLUMN order_status
  ENUM('pending','fabricating','in_warehouse','ready','in_delivery','delivered','cancelled')
  NOT NULL DEFAULT 'pending';
