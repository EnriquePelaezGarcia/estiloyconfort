const { Router } = require('express');
const contactController = require('../controllers/contactController');
const { contactIpLimiter } = require('../middleware/rateLimit');

const router = Router();

// Público a propósito: lo usa cualquier visitante desde /contacto.
router.post('/', contactIpLimiter, contactController.send);

module.exports = router;
