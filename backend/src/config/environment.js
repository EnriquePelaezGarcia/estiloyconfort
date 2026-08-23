require('dotenv').config();

/**
 * Centraliza el acceso a variables de entorno y valida las críticas.
 */
const env = {
  port: parseInt(process.env.PORT, 10) || 3000,
  nodeEnv: process.env.NODE_ENV || 'development',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'estilo_confort',
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  // Acepta uno o varios orígenes separados por coma, por ejemplo:
  //   CLIENT_ORIGIN=https://estiloyconfort.com,https://www.estiloyconfort.com
  clientOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:4200')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  // Correo transaccional: la recuperación de contraseña y el formulario de
  // Contacto.
  //
  // Se envía por la API HTTP de Resend (puerto 443), NO por SMTP. Hetzner
  // filtra los puertos SMTP salientes en el VPS: el 465 no se rechaza, se
  // queda colgado hasta agotar el timeout, así que el síntoma es un 504 de
  // nginx sin una sola línea de error en el log (comprobado el 23-ago-2026 —
  // 465 filtrado, 443 abierto). Ver utils/mailer.js.
  //
  // Sin la llave el mailer entra en modo consola: escribe el enlace en el log
  // en vez de enviarlo, y el backend arranca igual. Permite desarrollar en
  // local sin cuenta de correo y evita que una llave faltante en staging tire
  // toda la API.
  //
  // `RESEND_API_KEY` es el nombre bueno; se acepta `SMTP_PASS` como alterno
  // porque es donde vive hoy la llave en los .env de los tres ambientes y no
  // hay por qué editarlos a mano en el mismo despliegue de este cambio.
  mail: {
    apiKey: process.env.RESEND_API_KEY || process.env.SMTP_PASS || '',
    from:
      process.env.MAIL_FROM ||
      'Estilo y Confort <no-responder@send.estiloyconfortm.com>',
  },

  // Reseñas de Google (Places API). Sin apiKey el endpoint responde vacío y
  // la home simplemente no pinta el bloque: no se rompe nada.
  google: {
    apiKey: process.env.GOOGLE_PLACES_API_KEY || '',
    // Opcional: si se omite, se resuelve una vez con placeQuery y se cachea.
    placeId: process.env.GOOGLE_PLACE_ID || '',
    placeQuery:
      process.env.GOOGLE_PLACE_QUERY || 'Mueblería Estilo y Confort, Puebla, México',
  },

  // Buzón que recibe los mensajes del formulario público de Contacto. Es un
  // alias de Email Routing sobre el dominio propio, no una cuenta comprada
  // (ver memoria "correo-corporativo-email-routing").
  contact: {
    email: process.env.CONTACT_EMAIL || 'muebleria@estiloyconfortm.com',
  },
};

// Origen canónico para construir enlaces públicos (cotizaciones, tickets de
// venta que se mandan por WhatsApp). Es el primero de CLIENT_ORIGIN, así que
// ese debe ser el dominio principal, no el alias con www.
env.clientOrigin = env.clientOrigins[0];

// El envío real solo necesita la llave de Resend: el endpoint es fijo.
env.mail.enabled = Boolean(env.mail.apiKey);

env.isProduction = env.nodeEnv === 'production';

// Fallar rápido si faltan secretos JWT en arranque.
if (!env.jwt.accessSecret || !env.jwt.refreshSecret) {
  throw new Error(
    'Faltan JWT_ACCESS_SECRET y/o JWT_REFRESH_SECRET en el archivo .env',
  );
}

// En producción los secretos por defecto del .env.example son inaceptables:
// cualquiera que lea el repo podría firmar tokens válidos.
if (env.isProduction) {
  const weakSecrets = [env.jwt.accessSecret, env.jwt.refreshSecret].filter(
    (secret) => secret.length < 32 || secret.startsWith('cambia_esta_clave'),
  );
  if (weakSecrets.length > 0) {
    throw new Error(
      'Secretos JWT inseguros en producción: usa cadenas aleatorias de 32+ caracteres ' +
        '(genera con: openssl rand -base64 48)',
    );
  }
  if (!process.env.CLIENT_ORIGIN) {
    throw new Error(
      'Falta CLIENT_ORIGIN en producción: define el dominio del frontend para que CORS no quede abierto a localhost',
    );
  }
}

module.exports = env;
