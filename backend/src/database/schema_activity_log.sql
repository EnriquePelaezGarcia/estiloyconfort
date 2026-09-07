-- =====================================================================
-- Mueblería Estilo y Confort — Bitácora de ediciones (cotizaciones y pedidos)
--   node src/database/run-schema.js schema_activity_log.sql
--
-- Plan: cualquier vendedor puede ver y editar todas las cotizaciones,
-- precotizaciones y pedidos; cada edición deja rastro de QUIÉN la hizo y
-- QUÉ cambió, visible en el "Historial del pedido" y en el historial de la
-- cotización.
--
-- Registro append-only. La app la ESCRIBE (models/ActivityLog.js) — no hay
-- triggers. `actor_name` va desnormalizado para que el rastro sobreviva el
-- borrado de un usuario. `changes` guarda el detalle campo→{before,after}.
--
-- IDEMPOTENTE: `CREATE TABLE IF NOT EXISTS`. Sin backfill: arranca vacía y se
-- llena con las ediciones que ocurran de aquí en adelante.
--
-- ORDEN DE DESPLIEGUE: no depende de nada; correr una sola vez por ambiente
-- (local → preprod → prod).
-- =====================================================================

CREATE TABLE IF NOT EXISTS activity_log (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  entity_type ENUM('order','quote') NOT NULL,
  entity_id   INT NOT NULL,
  action      VARCHAR(40) NOT NULL,
  actor_id    INT NULL,
  actor_name  VARCHAR(160) NULL,
  actor_role  VARCHAR(30) NULL,
  summary     TEXT NULL,
  changes     JSON NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_activity_entity (entity_type, entity_id, created_at),
  CONSTRAINT fk_activity_actor FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
