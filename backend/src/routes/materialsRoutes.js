const { Router } = require('express');
const ctrl = require('../controllers/materialsController');

const router = Router();

// GET /api/materials — catálogo activo, público. El catálogo web (visitante
// anónimo) también necesita saber el label/color_policy de cada material
// para el selector de la ficha de producto (M5).
router.get('/', ctrl.getActive);

module.exports = router;
