const { Router } = require('express');
const roleController = require('../controllers/roleController');
const authenticate = require('../middleware/auth');
const authorize = require('../middleware/roleValidator');

const router = Router();

router.use(authenticate, authorize('admin'));

router.get('/', roleController.list);

module.exports = router;
