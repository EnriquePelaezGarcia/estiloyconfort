const ShippingRate = require('../models/ShippingRate');
const asyncHandler = require('../utils/asyncHandler');

const shippingController = {
  // GET /api/shipping/rates
  rates: asyncHandler(async (req, res) => {
    const data = await ShippingRate.findActive(req.query.city || 'Puebla');
    res.json({ data });
  }),

  // GET /api/shipping/quote?cp=72210
  quote: asyncHandler(async (req, res) => {
    const data = await ShippingRate.quoteByPostalCode(req.query.cp, req.query.city || 'Puebla');
    res.json({ data });
  }),
};

module.exports = shippingController;
