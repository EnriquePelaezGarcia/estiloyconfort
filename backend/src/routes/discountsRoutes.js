const { Router } = require('express');
const discountsController = require('../controllers/discountsController');
const authenticate = require('../middleware/auth');

const router = Router();

// Sin `authorize(...)`: vendedor, repartidor y admin por igual, cada quien
// ve solo su propio conteo (Docs/plan-descuentos.md, RN-D6).
router.use(authenticate);

router.get('/mine/rejected-count', discountsController.myRejectedCount);

module.exports = router;
