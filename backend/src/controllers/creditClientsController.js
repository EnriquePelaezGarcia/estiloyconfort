const Order = require('../models/Order');
const Payment = require('../models/Payment');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

/**
 * Módulo de clientes con crédito / sistema de apartado.
 * Accesible por vendedor (solo sus pedidos) y admin (todos).
 */
const creditClientsController = {
  // GET /api/credit-clients
  list: asyncHandler(async (req, res) => {
    const sellerId = req.user.role === 'admin' ? null : req.user.id;
    const clients = await Order.findCreditClients({ sellerId });
    res.json({ data: clients });
  }),

  // POST /api/credit-clients/:orderId/payments
  registerPayment: asyncHandler(async (req, res) => {
    const orderId = Number(req.params.orderId);
    const { amount, paymentMethod, notes } = req.body;

    if (!amount || Number(amount) <= 0) {
      throw ApiError.badRequest('El monto del abono debe ser mayor a 0');
    }

    const order = await Order.findById(orderId);
    if (!order) throw ApiError.notFound('Pedido no encontrado');
    if (!['store_credit', 'layaway'].includes(order.paymentMethod)) {
      throw ApiError.badRequest('Este pedido no es de crédito ni de apartado');
    }
    // Vendedor solo puede abonar a sus propios pedidos.
    if (req.user.role !== 'admin' && order.sellerId !== req.user.id) {
      throw ApiError.forbidden('No tienes permiso para abonar a este pedido');
    }

    const result = await Payment.create(
      { orderId, amount: Number(amount), paymentMethod, notes },
      req.user.id,
    );
    res.status(201).json({ data: result, message: 'Abono registrado' });
  }),
};

module.exports = creditClientsController;
