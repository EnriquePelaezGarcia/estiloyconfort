const { Router } = require('express');
const ctrl = require('../controllers/siteContentController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');

const router = Router();

// Pública: la ficha de producto la consume sin sesión.
router.get('/', ctrl.getAll);

// Admin — pantalla "Contenido".
router.put('/:key', authenticate, authorize('admin'), ctrl.update);

module.exports = router;
