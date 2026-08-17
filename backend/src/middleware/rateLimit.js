const rateLimit = require('express-rate-limit');

/**
 * Límite de intentos de inicio de sesión.
 *
 * Sin esto, cualquiera puede probar contraseñas contra /api/auth/login sin
 * freno hasta acertar. Con este límite, un ataque de fuerza bruta pasa de
 * miles de intentos por minuto a unas decenas por hora: deja de ser viable.
 *
 * `skipSuccessfulRequests` hace que solo cuenten los intentos FALLIDOS, así
 * que un vendedor que entra bien diez veces al día nunca gasta el cupo.
 *
 * ⚠️ El cupo es por IP. Si todos tus vendedores trabajan desde el mismo wifi
 * de la tienda, comparten una sola IP pública y por lo tanto el mismo cupo.
 * Por eso son 20 y no 10: deja margen para varios dedazos legítimos sin
 * dejar de ser efectivo contra un atacante.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    message:
      'Demasiados intentos fallidos de inicio de sesión. Espera 15 minutos e intenta de nuevo.',
  },
});

module.exports = { authLimiter };
