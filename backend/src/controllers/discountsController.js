const discountEngine = require('../models/discountEngine');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Badge propio de "descuentos rechazados sin ver" (Docs/plan-descuentos.md,
 * RN-D6) — disponible para cualquier rol autenticado, ya filtrado por
 * `req.user.id`: cada quien solo ve lo suyo.
 */
const discountsController = {
  // GET /api/discounts/mine/rejected-count
  myRejectedCount: asyncHandler(async (req, res) => {
    const count = await discountEngine.countMyUnseenRejections(req.user.id);
    res.json({ data: { count } });
  }),
};

module.exports = discountsController;
