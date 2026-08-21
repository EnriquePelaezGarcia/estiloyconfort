const { Router } = require('express');
const reviewsController = require('../controllers/reviewsController');

const router = Router();

// Público a propósito: lo consume la home antes de que nadie inicie sesión.
router.get('/google', reviewsController.google);

module.exports = router;
