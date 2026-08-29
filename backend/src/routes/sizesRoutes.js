const { Router } = require('express');
const ctrl = require('../controllers/sizesController');

const router = Router();

// GET /api/sizes — catálogo de tallas activo, público. El catálogo web
// (visitante anónimo) también lo necesita para el selector de talla de la
// ficha de producto (Docs/plan-productos-por-tamano.md — D8).
router.get('/', ctrl.getActive);

module.exports = router;
