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
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '1h',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '365d',
  },

  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:4200',
};

// Fallar rápido si faltan secretos JWT en arranque.
if (!env.jwt.accessSecret || !env.jwt.refreshSecret) {
  throw new Error(
    'Faltan JWT_ACCESS_SECRET y/o JWT_REFRESH_SECRET en el archivo .env',
  );
}

module.exports = env;
