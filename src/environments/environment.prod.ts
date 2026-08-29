export const environment = {
  production: true,
  apiUrl: 'https://api.estiloyconfortm.com/api',
  /** Origen público del sitio (sin `/` final). nginx redirige www → sin www. */
  siteUrl: 'https://estiloyconfortm.com',
  /** Número principal de la mueblería, en formato wa.me (52 + 10 dígitos). */
  whatsappNumber: '522221902631',
  /**
   * Redes sociales que salen en la barra superior. Si alguna queda vacía, su
   * ícono se pinta pero sin enlace, así la fila conserva su distribución.
   */
  social: {
    facebook: 'https://www.facebook.com/p/Estilo-y-Confort-61564752107831/',
    instagram: '',
    tiktok: '',
  },
};
