const { Router } = require('express');
const authController = require('../controllers/authController');
const authenticate = require('../middleware/auth');
const {
  authLimiter,
  forgotPasswordIpLimiter,
  forgotPasswordEmailLimiter,
} = require('../middleware/rateLimit');

const router = Router();

// El límite se aplica solo a login y register, que son las puertas de entrada.
// Deliberadamente NO se aplica a /refresh: el frontend lo llama cada vez que
// expira el access token (cada 15 min por usuario), y con varios vendedores
// tras la misma IP de la tienda se agotaría el cupo sin que nadie ataque nada.
router.post('/login', authLimiter, authController.login);
router.post('/register', authLimiter, authController.register);
router.post('/refresh', authController.refresh);
router.get('/me', authenticate, authController.me);

// Recuperación de contraseña (Docs/plan-modulo-contrasenas.md).
//
// Dos límites en cadena y no uno: el de IP frena al que dispara muchas veces
// desde un lugar, el de correo protege a cada buzón aunque el atacante rote de
// IP. El orden importa poco, pero el de correo va después porque necesita el
// cuerpo ya parseado.
router.post(
  '/forgot-password',
  forgotPasswordIpLimiter,
  forgotPasswordEmailLimiter,
  authController.forgotPassword,
);
// Con authLimiter porque quien adivina tokens está atacando la misma puerta.
router.post('/reset-password', authLimiter, authController.resetPassword);
router.post('/change-password', authenticate, authController.changePassword);

module.exports = router;
