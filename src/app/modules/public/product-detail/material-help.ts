/**
 * Explicación corta de cada material para el ⓘ del selector de material en la
 * ficha pública (Docs/plan-imagen-y-ayuda-por-material.md, Parte 1).
 *
 * Texto FIJO a propósito (decisión de Enrique): son 5 materiales, el texto es
 * estable y no vale la pena una columna en BD ni una pantalla de edición. La
 * clave es `materials.code` — un material nuevo sin entrada aquí simplemente
 * no muestra ⓘ.
 */
export const MATERIAL_HELP: Record<string, string> = {
  MDF:
    'Tablero de fibras de madera prensadas. Superficie muy lisa y pareja, '
    + 'ideal para acabados pintados o laqueados. Resistente y económico.',
  MELAMINA:
    'Aglomerado de madera cubierto con una lámina decorativa resistente. '
    + 'Viene en varios colores y texturas, fácil de limpiar y muy durable.',
  MADERA:
    'Madera maciza. La opción más resistente y de mayor vida útil; '
    + 'cada pieza tiene una veta única.',
  TELA:
    'Tapizado en tela sobre estructura de madera. El color del tapiz se elige aparte.',
  PLASTICO:
    'Polipropileno de alta resistencia. Ligero, lavable y resistente a la humedad.',
};
