const { Router } = require('express');
const authController = require('../controllers/authController');
const authenticate = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimit');

const router = Router();

// El límite se aplica solo a login y register, que son las puertas de entrada.
// Deliberadamente NO se aplica a /refresh: el frontend lo llama cada vez que
// expira el access token (cada 15 min por usuario), y con varios vendedores
// tras la misma IP de la tienda se agotaría el cupo sin que nadie ataque nada.
router.post('/login', authLimiter, authController.login);
router.post('/register', authLimiter, authController.register);
router.post('/refresh', authController.refresh);
router.get('/me', authenticate, authController.me);

module.exports = router;
