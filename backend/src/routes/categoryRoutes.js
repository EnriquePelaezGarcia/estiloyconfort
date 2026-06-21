const { Router } = require('express');
const ctrl = require('../controllers/categoryController');

const router = Router();

router.get('/', ctrl.getAll);
router.get('/:slug', ctrl.getOne);

module.exports = router;
