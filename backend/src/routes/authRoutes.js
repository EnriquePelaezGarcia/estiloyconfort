const { Router } = require('express');
const authController = require('../controllers/authController');
const authenticate = require('../middleware/auth');

const router = Router();

router.post('/login', authController.login);
router.post('/register', authController.register);
router.post('/refresh', authController.refresh);
router.get('/me', authenticate, authController.me);

module.exports = router;
