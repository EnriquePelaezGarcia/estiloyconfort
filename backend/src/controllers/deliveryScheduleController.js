const DeliverySchedule = require('../models/DeliverySchedule');
const Order = require('../models/Order');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

/**
 * Agenda de entregas (Docs/plan-fecha-hora-entrega.md).
 *
 * El alcance SIEMPRE sale de `req.user` (D2), nunca de un parámetro: un
 * vendedor no puede pedir la agenda de otro cambiando el query string.
 */
const deliveryScheduleController = {
  // GET /api/deliveries/schedule?from=&to=&commitment=
  schedule: asyncHandler(async (req, res) => {
    const { from, to, commitment } = req.query;
    const scope = { role: req.user.role, userId: req.user.id };
    const [deliveries, counts] = await Promise.all([
      DeliverySchedule.findSchedule({ ...scope, from, to, commitment }),
      DeliverySchedule.counts(scope),
    ]);
    res.json({ data: { deliveries, counts } });
  }),

  // GET /api/deliveries/schedule/counts — sólo el badge del menú, sin listado.
  counts: asyncHandler(async (req, res) => {
    const counts = await DeliverySchedule.counts({ role: req.user.role, userId: req.user.id });
    res.json({ data: counts });
  }),

  // GET /api/deliveries/slots
  slots: asyncHandler(async (req, res) => {
    const data = await DeliverySchedule.listSlots();
    res.json({ data });
  }),

  /**
   * PATCH /api/deliveries/orders/:id/schedule — reprograma fecha, tipo de
   * compromiso y ventana horaria.
   *
   * A diferencia de la edición normal del pedido, esto SÍ se permite con el
   * pedido 'in_delivery': mover la hora de una entrega que ya salió es
   * justamente el caso que hay que poder resolver por teléfono. Lo único
   * cerrado es lo ya entregado o cancelado.
   */
  reschedule: asyncHandler(async (req, res) => {
    const existing = await Order.findById(req.params.id);
    if (!existing) throw ApiError.notFound('Pedido no encontrado');
    if (req.user.role === 'seller' && existing.sellerId !== req.user.id) {
      throw ApiError.forbidden('Este pedido no te pertenece');
    }
    if (['delivered', 'cancelled'].includes(existing.orderStatus)) {
      throw ApiError.badRequest('No se puede reprogramar un pedido entregado o cancelado');
    }

    const {
      expectedDeliveryDate, deliveryCommitment, deliverySlotId,
      deliveryWindowStart, deliveryWindowEnd, rescheduleReason,
    } = req.body ?? {};

    const order = await Order.update(req.params.id, {
      expectedDeliveryDate: expectedDeliveryDate ?? null,
      deliveryCommitment: deliveryCommitment ?? 'tentative',
      deliverySlotId: deliverySlotId ?? null,
      deliveryWindowStart: deliveryWindowStart ?? null,
      deliveryWindowEnd: deliveryWindowEnd ?? null,
      rescheduleReason,
    }, req.user.id);

    res.json({ data: order, message: 'Entrega reprogramada' });
  }),

  // GET /api/deliveries/orders/:id/history
  history: asyncHandler(async (req, res) => {
    const existing = await Order.findById(req.params.id);
    if (!existing) throw ApiError.notFound('Pedido no encontrado');
    if (req.user.role === 'seller' && existing.sellerId !== req.user.id) {
      throw ApiError.forbidden('Este pedido no te pertenece');
    }
    const data = await Order.findDeliveryHistory(req.params.id);
    res.json({ data });
  }),
};

module.exports = deliveryScheduleController;
