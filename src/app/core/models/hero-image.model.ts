/**
 * Foto del hero de la portada, administrada en Sitio público → Contenido.
 * El modo lo decide el conteo, no una bandera: una sola foto queda fija y
 * dos o más arman el carrusel (ver home.component).
 */
export interface HeroImage {
  id: number;
  /** Ruta relativa (/uploads/hero/...); se resuelve con el pipe mediaUrl. */
  image_url: string;
  alt_text: string | null;
  order_display: number;
}
