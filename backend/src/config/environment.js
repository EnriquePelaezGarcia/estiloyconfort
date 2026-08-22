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

  // Correo transaccional: hoy solo la recuperación de contraseña.
  //
  // Sin SMTP_HOST o sin SMTP_PASS el mailer entra en modo consola: escribe el
  // enlace en el log en vez de enviarlo, y el backend arranca igual. Permite
  // desarrollar en local sin cuenta de correo y evita que una llave faltante
  // en staging tire toda la API. Ver utils/mailer.js.
  mail: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT, 10) || 465,
    user: process.env.SMTP_USER || '',
    password: process.env.SMTP_PASS || '',
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
  }
};

// Origen canónico para construir enlaces públicos (cotizaciones, tickets de
// venta que se mandan por WhatsApp). Es el primero de CLIENT_ORIGIN, así que
// ese debe ser el dominio principal, no el alias con www.
env.clientOrigin = env.clientOrigins[0];

// El envío real necesita servidor y contraseña. Con uno solo de los dos el
// transporte fallaría en cada correo, así que se prefiere el modo consola.
env.mail.enabled = Boolean(env.mail.host && env.mail.password);

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
