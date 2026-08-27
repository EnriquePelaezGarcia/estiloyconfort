/**
 * Bloque de contenido fijo del sitio (política de envíos, aceptación de
 * política...): mismo `body` para cualquier producto, capturado en el admin
 * con un editor de texto enriquecido. `content_key` identifica cuál es —
 * el conjunto de bloques lo define el backend, no se crean/borran desde aquí.
 */
export interface SiteContent {
  content_key: string;
  title: string;
  /** HTML del editor (ngx-quill). Se sanea al mostrarlo con [innerHTML]. */
  body: string;
  updated_at: string;
}
