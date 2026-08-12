const { Router } = require('express');
const payablesController = require('../controllers/payablesController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');

const router = Router();

// Cuentas por pagar es información financiera de la tienda: solo admin.
// El fabricante ve SU parte por /api/manufacturer/history, que fuerza su id.
router.use(authenticate, authorize('admin'));

// ORDEN CRÍTICO: las rutas específicas van antes que las paramétricas.
router.get('/documents/:sourceType/:sourceId', payablesController.documentDetail);
router.get('/documents', payablesController.documents);
router.get('/cut', payablesController.cut);

router.get('/batches', payablesController.listBatches);
router.post('/batches', payablesController.createBatch);
router.delete('/batches/:id', payablesController.removeBatch);

router.post('/charges', payablesController.addCharge);
router.delete('/charges/:id', payablesController.removeCharge);

router.get('/', payablesController.summary);

module.exports = router;
