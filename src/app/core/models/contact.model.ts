/** Cuerpo que manda el formulario público de /contacto. */
export interface ContactRequest {
  name: string;
  email: string;
  phone?: string;
  message: string;
}

/** Respuesta del backend al enviar el formulario de contacto. */
export interface ContactResponse {
  message: string;
}
