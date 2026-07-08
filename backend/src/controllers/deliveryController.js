const Delivery = require('../models/Delivery');
const Payment = require('../models/Payment');
const Order = require('../models/Order');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

/**
 * Controlador del módulo Repartidor (rol: delivery_person).
 * Solo accede a las entregas asignadas a sí mismo.
 */
const deliveryController = {
  // GET /api/delivery/assignments?date=YYYY-MM-DD (default: hoy)
  assignments: asyncHandler(async (req, res) => {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const all = req.query.all === 'true';
    const deliveries = await Delivery.findByPerson(req.user.id, all ? {} : { date });
    res.json({ data: deliveries });
  }),

  // GET /api/delivery/assignments/:id
  getOne: asyncHandler(async (req, res) => {
    const delivery = await Delivery.findById(req.params.id);
    if (!delivery) throw ApiError.notFound('Entrega no encontrada');
    if (delivery.deliveryPersonId !== req.user.id) throw ApiError.forbidden('Entrega no asignada a ti');
    res.json({ data: delivery });
  }),

  // PATCH /api/delivery/assignments/:id/status
  updateStatus: asyncHandler(async (req, res) => {
    const { status } = req.body;
    const valid = ['pending', 'in_progress', 'completed', 'failed'];
    if (!valid.includes(status)) throw ApiError.badRequest('Estado inválido');

    const delivery = await Delivery.findById(req.params.id);
    if (!delivery) throw ApiError.notFound('Entrega no encontrada');
    if (delivery.deliveryPersonId !== req.user.id) throw ApiError.forbidden('Entrega no asignada a ti');

    // Para completar se exige firma y foto.
    if (status === 'completed' && (!delivery.signatureImageUrl || !delivery.photoUrl)) {
      throw ApiError.badRequest('Se requiere firma y foto antes de marcar como entregada');
    }
    const updated = await Delivery.updateStatus(req.params.id, status);
    res.json({ data: updated, message: 'Estado actualizado' });
  }),

  // POST /api/delivery/assignments/:id/proof — guarda firma/foto (base64)
  saveProof: asyncHandler(async (req, res) => {
    const delivery = await Delivery.findById(req.params.id);
    if (!delivery) throw ApiError.notFound('Entrega no encontrada');
    if (delivery.deliveryPersonId !== req.user.id) throw ApiError.forbidden('Entrega no asignada a ti');
    const updated = await Delivery.saveProof(req.params.id, req.body);
    res.json({ data: updated, message: 'Evidencia guardada' });
  }),

  // PATCH /api/delivery/assignments/:id/payment — registra cobro en la entrega
  // Acepta `{ payments: [{amount, paymentMethod}] }` (cobro dividido) o `{ amount, paymentMethod }`.
  registerPayment: asyncHandler(async (req, res) => {
    const { amount, payments } = req.body;
    const lines = Array.isArray(payments) ? payments : null;
    const totalAmount = lines
      ? lines.reduce((sum, p) => sum + Number(p.amount || 0), 0)
      : Number(amount);
    if (!(totalAmount > 0)) throw ApiError.badRequest('Al menos un cobro con monto mayor a 0 es obligatorio');

    const delivery = await Delivery.findById(req.params.id);
    if (!delivery) throw ApiError.notFound('Entrega no encontrada');
    if (delivery.deliveryPersonId !== req.user.id) throw ApiError.forbidden('Entrega no asignada a ti');

    const result = await Payment.create(
      { orderId: delivery.orderId, amount, payments, notes: 'Cobro en entrega' },
      req.user.id,
    );
    res.status(201).json({ data: result, message: 'Cobro registrado' });
  }),
};

module.exports = deliveryController;
