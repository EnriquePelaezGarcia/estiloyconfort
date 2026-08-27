const { pool } = require('../config/database');
const Order = require('../models/Order');
const OrderStatusHistory = require('../models/OrderStatusHistory');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

/**
 * Rastreador público de pedidos (Plan Docs/plan-rastreo-pedido-cliente.md,
 * Parte B). Sin sesión: el cliente se identifica con el número de pedido + los
 * últimos 4 dígitos del teléfono con el que compró.
 *
 * Espejo de `ticketsController.publicByToken`: la respuesta se arma campo por
 * campo (lista blanca) y NUNCA devuelve el objeto del pedido crudo. Jamás sale
 * dinero, saldo, dirección, notas internas, fabricante, ids ni vendedor.
 */

const ORDER_NUMBER_RE = /^EC-\d{8}-\d{4}$/;
const LAST4_RE = /^\d{4}$/;

// Una sola respuesta para "no existe" / "teléfono no coincide" / "sin teléfono":
// nunca se revela qué campo falló (Plan §Parte B, paso 4).
const GENERIC_NOT_FOUND =
  'No encontramos un pedido con esos datos. Revisa el número y el teléfono, o escríbenos por WhatsApp.';

module.exports = {
  // POST /api/tracking/lookup  { orderNumber, phoneLast4 }
  lookup: asyncHandler(async (req, res) => {
    const orderNumber = String(req.body.orderNumber ?? '').trim().toUpperCase();
    const phoneLast4 = String(req.body.phoneLast4 ?? '').trim();

    if (!ORDER_NUMBER_RE.test(orderNumber) || !LAST4_RE.test(phoneLast4)) {
      throw ApiError.notFound(GENERIC_NOT_FOUND);
    }

    const [[order]] = await pool.execute(
      `SELECT o.id, o.order_number, o.order_date, o.customer_name, o.customer_phone,
              o.order_status, o.payment_method, o.payment_amount, o.total_amount,
              o.down_payment, o.pickup_in_store, o.delivery_type,
              o.expected_delivery_date, o.delivery_commitment, o.layaway_converted
         FROM orders o
        WHERE o.order_number = ?`,
      [orderNumber],
    );

    const phoneDigits = String(order?.customer_phone ?? '').replace(/\D/g, '');
    if (!order || phoneDigits.length < 4 || phoneDigits.slice(-4) !== phoneLast4) {
      throw ApiError.notFound(GENERIC_NOT_FOUND);
    }

    const timeline = await OrderStatusHistory.findByOrderId(order.id);
    const statusSeq = timeline.map((t) => t.status);
    const historyHas = (s) => statusSeq.includes(s);

    const [items] = await pool.execute(
      `SELECT oi.product_name, oi.quantity, oi.requires_fabrication,
              (SELECT image_url FROM product_images
                WHERE product_id = oi.product_id AND is_primary = TRUE LIMIT 1) AS image_url
         FROM order_items oi WHERE oi.order_id = ? ORDER BY oi.id`,
      [order.id],
    );

    // Un rebote in_delivery → ready en el historial = hubo un intento fallido.
    let hadFailedDeliveryAttempt = false;
    for (let i = 1; i < statusSeq.length; i += 1) {
      if (statusSeq[i] === 'ready' && statusSeq[i - 1] === 'in_delivery') {
        hadFailedDeliveryAttempt = true;
        break;
      }
    }

    // C-1: el pedido volvió a 'fabricating' habiendo estado ya en 'in_delivery'
    // (mueble dañado que el admin mandó a rehacer).
    const isReFabricating = order.order_status === 'fabricating' && historyHas('in_delivery');

    const clearsPayment = Order.paymentClearsForDelivery({
      paymentMethod: order.payment_method,
      paymentAmount: order.payment_amount,
      downPayment: order.down_payment,
      totalAmount: order.total_amount,
    });
    const paymentBlocksDelivery = order.order_status === 'in_warehouse' && !clearsPayment;

    const isCancelled = order.order_status === 'cancelled';

    res.json({
      data: {
        orderNumber: order.order_number,
        orderDate: order.order_date,
        // Sólo el primer nombre — no el apellido.
        customerFirstName: String(order.customer_name ?? '').trim().split(/\s+/)[0] || '',
        orderStatus: order.order_status,
        paymentMethodScheme: order.payment_method,
        isCancelled,
        isReturned: isCancelled && historyHas('delivered'),
        pickupInStore: !!order.pickup_in_store,
        deliveryType: order.delivery_type,
        expectedDeliveryDate: order.expected_delivery_date,
        deliveryCommitment: order.delivery_commitment ?? 'tentative',
        hasFabricationItems: items.some((it) => !!it.requires_fabrication),
        paymentBlocksDelivery,
        hadFailedDeliveryAttempt,
        isReFabricating,
        layawayExpired: !!order.layaway_converted,
        timeline: timeline.map((t) => ({ status: t.status, changedAt: t.changedAt })),
        items: items.map((it) => ({
          productName: it.product_name,
          quantity: it.quantity,
          imageUrl: it.image_url ?? null,
        })),
      },
    });
  }),
};
