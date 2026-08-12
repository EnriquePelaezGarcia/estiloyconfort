const Quote = require('../models/Quote');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const env = require('../config/environment');

/**
 * URL pública que el vendedor comparte por WhatsApp. Se calcula al vuelo en
 * vez de guardarse en BD: si mañana cambia el dominio, los links viejos
 * siguen funcionando sin migrar una sola fila.
 */
function shareUrlFor(token) {
  return `${env.clientOrigin}/cotizacion/${token}`;
}

function withShareUrl(quote) {
  return { ...quote, shareUrl: shareUrlFor(quote.token) };
}

/** Solo el dueño de la cotización o un admin pueden operarla. */
function assertCanManage(quote, user) {
  if (user.role === 'admin') return;
  if (quote.sellerId !== user.id) {
    throw ApiError.forbidden('Esta cotización no te pertenece');
  }
}

const quotesController = {
  // POST /api/quotes
  create: asyncHandler(async (req, res) => {
    if (!req.body.customerName || !String(req.body.customerName).trim()) {
      throw ApiError.badRequest('El nombre del cliente es obligatorio');
    }
    if (!Array.isArray(req.body.items) || req.body.items.length === 0) {
      throw ApiError.badRequest('La cotización debe incluir al menos un producto');
    }
    const quote = await Quote.create(req.body, req.user.id);
    res.status(201).json({ data: withShareUrl(quote), message: 'Cotización creada' });
  }),

  // GET /api/quotes — propias (vendedor) o todas (admin)
  list: asyncHandler(async (req, res) => {
    const data = await Quote.findAllForUser(req.user);
    res.json({ data: data.map(withShareUrl) });
  }),

  // GET /api/quotes/:id — detalle interno
  getOne: asyncHandler(async (req, res) => {
    const quote = await Quote.findById(req.params.id);
    if (!quote) throw ApiError.notFound('Cotización no encontrada');
    assertCanManage(quote, req.user);
    res.json({ data: withShareUrl(quote) });
  }),

  // PATCH /api/quotes/:id/confirm — el cliente aceptó por WhatsApp
  confirm: asyncHandler(async (req, res) => {
    const existing = await Quote.findById(req.params.id);
    if (!existing) throw ApiError.notFound('Cotización no encontrada');
    assertCanManage(existing, req.user);
    if (existing.status === 'converted') {
      throw ApiError.badRequest('Esta cotización ya se convirtió en pedido');
    }
    const quote = await Quote.confirm(req.params.id);
    res.json({ data: withShareUrl(quote), message: 'Cotización confirmada' });
  }),

  // DELETE /api/quotes/:id
  remove: asyncHandler(async (req, res) => {
    const existing = await Quote.findById(req.params.id);
    if (!existing) throw ApiError.notFound('Cotización no encontrada');
    assertCanManage(existing, req.user);
    await Quote.remove(req.params.id);
    res.json({ message: 'Cotización eliminada' });
  }),

  // GET /api/quotes/public/:token — SIN AUTENTICACIÓN (link del cliente)
  // Devuelve 404 tanto si el token no existe como si la cotización venció:
  // desde afuera no se distingue "nunca existió" de "ya expiró".
  publicByToken: asyncHandler(async (req, res) => {
    const quote = await Quote.findByToken(req.params.token);
    if (!quote) throw ApiError.notFound('Esta cotización ya no está disponible');
    // El link es público: no se filtra id interno, token ni datos del vendedor
    // más allá de su nombre.
    res.json({
      data: {
        customerName: quote.customerName,
        sellerName: quote.sellerName,
        paymentMethod: quote.paymentMethod,
        shippingPostalCode: quote.shippingPostalCode,
        shippingCost: quote.shippingCost,
        shippingZoneLabel: quote.shippingZoneLabel,
        assemblyService: quote.assemblyService,
        assemblyFloors: quote.assemblyFloors,
        assemblyCost: quote.assemblyCost,
        subtotal: quote.subtotal,
        totalAmount: quote.totalAmount,
        // Plan de financiamiento: el cliente a crédito pregunta justo esto,
        // así se evita el ida y vuelta por WhatsApp.
        cashTotal: quote.cashTotal,
        downPayment: quote.downPayment,
        weeklyPayment: quote.weeklyPayment,
        lastPayment: quote.lastPayment,
        creditWeeks: quote.creditWeeks,
        layawayDeadline: quote.layawayDeadline,
        wholesaleIva: quote.wholesaleIva,
        expiresAt: quote.expiresAt,
        createdAt: quote.createdAt,
        items: quote.items,
      },
    });
  }),
};

module.exports = quotesController;
