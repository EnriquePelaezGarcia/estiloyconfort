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

  // GET /api/shipping/public-quote?cp=72210 — PÚBLICO (carrito, sin sesión).
  // El cliente cotiza su envío escribiendo su CP antes de finalizar el pedido.
  // Solo expone precio y etiqueta de zona — la misma tabla de referencia, sin
  // datos internos. null = fuera de cobertura ("un asesor te confirma").
  publicQuote: asyncHandler(async (req, res) => {
    const quote = await ShippingRate.quoteByPostalCode(req.query.cp, req.query.city || 'Puebla');
    res.json({ data: quote ? { price: quote.price, label: quote.label, isFree: quote.isFree } : null });
  }),
};

module.exports = shippingController;
