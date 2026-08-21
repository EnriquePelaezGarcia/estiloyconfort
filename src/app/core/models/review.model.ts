/** Una reseña de Google, ya aplanada por el backend. */
export interface GoogleReview {
  author: string;
  photo: string | null;
  /** Perfil del autor: los términos de Google piden enlazarlo al mostrar su reseña. */
  profileUrl: string | null;
  rating: number | null;
  text: string;
  /** Texto relativo que da Google, p. ej. "hace 2 meses". */
  when: string | null;
}

export interface GoogleReviews {
  /** Promedio del negocio; null si Google no lo devolvió. */
  rating: number | null;
  /** Total de calificaciones (no de reseñas con texto). */
  total: number;
  /** Ficha del negocio en Google Maps, para "ver todas". */
  url: string | null;
  /** Google entrega máximo 5. Vacío = no configurado o falló la consulta. */
  reviews: GoogleReview[];
}
