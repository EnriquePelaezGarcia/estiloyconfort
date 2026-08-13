const StockReservation = require('../models/StockReservation');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

/**
 * Reservas de inventario (Docs/plan-reserva-de-piezas.md). Compartido entre
 * admin y vendedor (D2/D7): ambos roles ven y liberan cualquier reserva.
 *
 * D4: no hay creación suelta aquí a propósito — toda reserva nace del
 * payload de crear/editar un pedido (items[].reserve), resuelta dentro de
 * Order.create()/updateWithItems().
 */
const reservationsController = {
  // GET /api/inventory/reservations?status=active&productId=&search=
  list: asyncHandler(async (req, res) => {
    const { status, productId, search } = req.query;
    const data = await StockReservation.listAll({ status, productId, search });
    res.json({ data });
  }),

  // PATCH /api/inventory/reservations/:id/release
  release: asyncHandler(async (req, res) => {
    const existing = await StockReservation.findById(req.params.id);
    if (!existing) throw ApiError.notFound('Reserva no encontrada');
    const reservation = await StockReservation.release(req.params.id, {
      releasedBy: req.user.id,
      releasedReason: req.body?.releasedReason ?? null,
    });
    res.json({ data: reservation, message: 'Reserva liberada' });
  }),
};

module.exports = reservationsController;
