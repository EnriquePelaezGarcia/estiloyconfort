-- =====================================================================
-- env_lock_production.sql — marca ESTA base como PRODUCCIÓN.
--
-- Se corre UNA sola vez, SOLO en el servidor de producción:
--   node src/database/run-schema.js env_lock_production.sql
--
-- Crea una tabla-centinela inerte (sin FK, sin uso en el código de la app).
-- Su única función: que `reset_all_data_2026.sql` se niegue a correr aquí.
--
-- Idempotente y reversible. Para quitar la marca (no recomendado):
--   DROP TABLE _environment_lock;
-- =====================================================================

CREATE TABLE IF NOT EXISTS _environment_lock (
  environment VARCHAR(20)  NOT NULL PRIMARY KEY,
  note        VARCHAR(255) NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO _environment_lock (environment, note)
VALUES ('production',
        'Base de PRODUCCION. reset_all_data_2026.sql aborta si esta fila existe. NO BORRAR.')
ON DUPLICATE KEY UPDATE note = VALUES(note);
