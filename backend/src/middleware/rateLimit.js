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

/**
 * Recuperación de contraseña, eje 1: por IP.
 *
 * `forgot-password` es público y cada llamada legítima manda un correo, así que
 * se limita más fuerte que el login. No lleva `skipSuccessfulRequests`: aquí
 * TODAS las peticiones responden 200 —incluso las de correos inexistentes, por
 * la regla de respuesta genérica—, así que saltarse las exitosas dejaría el
 * límite sin efecto.
 */
const forgotPasswordIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    message: 'Demasiadas solicitudes. Espera unos minutos e intenta de nuevo.',
  },
});

/**
 * Recuperación de contraseña, eje 2: por dirección de correo.
 *
 * El eje de IP solo no basta: un atacante rota direcciones IP y vuelve a
 * disparar contra el mismo buzón. Este segundo eje protege a cada dirección sin
 * importar de dónde venga la petición. Y al revés tampoco basta: el eje de
 * correo no frena a quien dispara contra muchas direcciones distintas.
 *
 * `keyGeneratorIpFallback: false` desactiva la validación que exige normalizar
 * IPv6 en el keyGenerator: aquí la llave es un correo, no una IP.
 */
const forgotPasswordEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 3,
  keyGenerator: (req) =>
    String(req.body?.email || '').trim().toLowerCase() || 'sin-correo',
  validate: { keyGeneratorIpFallback: false },
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    message: 'Demasiadas solicitudes para esta dirección. Intenta de nuevo más tarde.',
  },
});

/**
 * Formulario público de Contacto: cada llamada legítima manda un correo real,
 * así que se limita por IP para que nadie lo use para inundar el buzón.
 */
const contactIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    message: 'Demasiados mensajes enviados. Espera unos minutos e intenta de nuevo.',
  },
});

module.exports = {
  authLimiter,
  forgotPasswordIpLimiter,
  forgotPasswordEmailLimiter,
  contactIpLimiter,
};
