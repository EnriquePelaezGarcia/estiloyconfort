const Order = require('../models/Order');
const PricingConfig = require('../models/PricingConfig');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

/**
 * Ticket de venta compartible por WhatsApp.
 *
 * Dos mitades con seguridad opuesta, a propósito:
 *  - `share`  exige sesión de vendedor/admin y emite el link.
 *  - `publicByToken` no exige nada: lo abre el cliente, que no tiene cuenta.
 *
 * Espejo de quotesController (link público de cotizaciones): el token de la
 * URL es la única credencial, así que la respuesta pública se arma campo por
 * campo y NUNCA devuelve el objeto del pedido tal cual.
 */
module.exports = {
  // POST /api/seller/orders/:id/share — emite (o reusa) el link público.
  share: asyncHandler(async (req, res) => {
    const token = await Order.ensureShareToken(req.params.id);
    if (!token) throw ApiError.notFound('Pedido no encontrado');
    res.json({ data: { token } });
  }),

  // GET /api/tickets/public/:token — sin sesión.
  publicByToken: asyncHandler(async (req, res) => {
    const order = await Order.findByShareToken(req.params.token);
    if (!order) throw ApiError.notFound('Este ticket ya no está disponible');

    // M13: el ticket térmico desglosa el IVA de Mayoreo con la tasa VIGENTE
    // (no la congelada al vender) — el ticket público hace lo mismo.
    const config = await PricingConfig.getMap();

    // Lista blanca explícita. Lo que NO sale al público y por qué:
    //  - costos, fabricante y márgenes: información interna del negocio
    //  - notasFabricante / instruccionesEntrega: notas operativas internas
    //  - id, sellerId, token: llaves internas
    res.json({
      data: {
        orderNumber: order.orderNumber,
        orderDate: order.orderDate,
        orderStatus: order.orderStatus,
        paymentStatus: order.paymentStatus,
        paymentMethod: order.paymentMethod,
        customerName: order.customerName,
        sellerName: order.sellerName,

        deliveryType: order.deliveryType,
        /** Recoge en tienda: el ticket muestra eso en lugar de la dirección. */
        pickupInStore: order.pickupInStore,
        deliveryAddress: order.deliveryAddress,
        expectedDeliveryDate: order.expectedDeliveryDate,
        deliveryCommitment: order.deliveryCommitment,
        deliveryWindowStart: order.deliveryWindowStart,
        deliveryWindowEnd: order.deliveryWindowEnd,

        shippingCost: order.shippingCost,
        shippingPostalCode: order.shippingPostalCode,
        assemblyService: order.assemblyService,
        assemblyFloors: order.assemblyFloors,
        assemblyCost: order.assemblyCost,

        // Docs/plan-aprobaciones-admin.md RN-EC8: desglosados por etiqueta;
        // los rechazados no se muestran. Solo label/amount — nunca status ni
        // quién lo pidió (mismo criterio de lista blanca de todo este objeto).
        extraCharges: (order.extraCharges ?? [])
          .filter((c) => c.status !== 'rejected')
          .map((c) => ({ label: c.label, amount: c.amount })),

        totalAmount: order.totalAmount,
        paymentAmount: order.paymentAmount,
        // El saldo es justo lo que el cliente abre el link a consultar.
        balance: Math.max(0, order.totalAmount - order.paymentAmount),

        // Plan de crédito: evita el ida y vuelta por WhatsApp preguntando
        // "¿de cuánto es mi pago semanal?".
        cashTotal: order.cashTotal ?? null,
        downPayment: order.downPayment ?? null,
        creditWeeks: order.creditWeeks ?? null,
        weeklyPayment: order.weeklyPayment ?? null,

        // M13: para que el ticket público pueda desglosar el IVA de Mayoreo
        // igual que el ticket térmico.
        ivaRate: Number(config.iva),
        wholesalePriceIncludesIva: Number(config.wholesale_price_includes_iva) === 1,

        items: (order.items ?? []).map((it) => ({
          productName: it.productName,
          materialLabel: it.materialLabel,
          color: it.color,
          quantity: it.quantity,
          unitPrice: it.unitPrice,
          subtotal: it.subtotal,
          // No es información sensible (costos/margen); decide si se muestra
          // el aviso de fecha estimada por fabricación/agotado.
          requiresFabrication: it.requiresFabrication,
          imageUrl: it.imageUrl,
        })),

        payments: (order.payments ?? []).map((p) => ({
          paymentDate: p.paymentDate,
          amount: p.amount,
        })),
      },
    });
  }),
};
