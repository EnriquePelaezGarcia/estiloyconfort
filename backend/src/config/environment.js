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
};

// Origen canónico para construir enlaces públicos (cotizaciones, tickets de
// venta que se mandan por WhatsApp). Es el primero de CLIENT_ORIGIN, así que
// ese debe ser el dominio principal, no el alias con www.
env.clientOrigin = env.clientOrigins[0];

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
