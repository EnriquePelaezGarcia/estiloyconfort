const DeliverySchedule = require('../models/DeliverySchedule');
const Delivery = require('../models/Delivery');
const Order = require('../models/Order');
const PricingConfig = require('../models/PricingConfig');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

/**
 * Agenda de entregas (Docs/plan-fecha-hora-entrega.md).
 *
 * El alcance SIEMPRE sale de `req.user` (D2), nunca de un parámetro. Admin y
 * vendedor ven la agenda completa de todos los vendedores (igual que el
 * listado de pedidos); el repartidor solo ve lo que trae asignado.
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

  // GET /api/deliveries/schedule/slot-count?date=&slotId= — Docs/plan-aprobaciones-admin.md
  // §11.3: aviso NO bloqueante de sobre-compromiso al capturar "Día preciso".
  slotCount: asyncHandler(async (req, res) => {
    const { date, slotId } = req.query;
    if (!date || !slotId) throw ApiError.badRequest('date y slotId son obligatorios');
    const [count, config] = await Promise.all([
      DeliverySchedule.countForSlot(date, Number(slotId)),
      PricingConfig.getMap(),
    ]);
    res.json({ data: { count, threshold: Number(config.max_deliveries_per_slot) } });
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
    const data = await Order.findDeliveryHistory(req.params.id);
    res.json({ data });
  }),

  /**
   * GET /api/deliveries/route?deliveryPersonId=&date= — la ruta de un
   * repartidor ese día (plan agenda-agregar-orden-de-entrega), para pintarla
   * en el modal "Asignar repartidor" y elegir dónde cae la parada nueva.
   */
  route: asyncHandler(async (req, res) => {
    const { deliveryPersonId, date } = req.query;
    if (!deliveryPersonId || !date) {
      throw ApiError.badRequest('deliveryPersonId y date son obligatorios');
    }
    const data = await Delivery.findByPerson(Number(deliveryPersonId), { date });
    res.json({ data });
  }),

  /**
   * PATCH /api/deliveries/route/reorder — fija el orden final de una ruta.
   * `deliveryIds` son ids de ENTREGA (deliveries.id), no de pedido, en el
   * orden final deseado. Sin restricción de unicidad: si dos quedan con el
   * mismo número, el frontend solo avisa.
   */
  reorderRoute: asyncHandler(async (req, res) => {
    const { deliveryIds } = req.body ?? {};
    if (!Array.isArray(deliveryIds) || deliveryIds.length === 0) {
      throw ApiError.badRequest('deliveryIds debe ser un arreglo con al menos un elemento');
    }
    await Delivery.reorderRoute(deliveryIds.map(Number));
    res.json({ message: 'Ruta reordenada' });
  }),
};

module.exports = deliveryScheduleController;
