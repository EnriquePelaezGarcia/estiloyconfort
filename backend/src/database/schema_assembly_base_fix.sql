-- ═══════════════════════════════════════════════════════════════════════════
-- Corrección de la tarifa base de armado: 150 → 100
--
-- schema_assembly.sql sembró assembly_base = 150, pero la tarifa correcta de
-- planta baja es 100. Con la fórmula base + pisos × 50 eso dejaba todos los
-- pisos 50 pesos arriba de lo debido:
--
--        piso        antes   correcto
--   planta baja (0)   150      100
--   primer piso  (1)  200      150
--   segundo piso (2)  250      200
--   tercer piso  (3)  300      250   (y así, +50 por piso)
--
-- El INSERT ... ON DUPLICATE KEY de schema_assembly.sql NO actualiza
-- config_value (para no pisar ajustes del negocio), así que en los ambientes
-- que ya lo corrieron el valor sigue en 150 y hay que corregirlo aquí.
--
-- Script repetible: si ya está en 100 no hace nada.
-- ═══════════════════════════════════════════════════════════════════════════

USE estilo_confort;

UPDATE pricing_config
   SET config_value = 100.0000
 WHERE config_key = 'assembly_base'
   AND config_value = 150.0000;
