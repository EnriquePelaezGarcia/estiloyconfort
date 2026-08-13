const { Router } = require('express');
const ticketsController = require('../controllers/ticketsController');

const router = Router();

// Router 100% público: lo abre el cliente desde el link de WhatsApp, sin
// cuenta. El token de la URL es la única credencial. La contraparte que EMITE
// el token sí exige sesión y vive en sellerRoutes.
router.get('/public/:token', ticketsController.publicByToken);

module.exports = router;
