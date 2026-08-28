const QuoteRequest = require('../models/QuoteRequest');
const Inventory = require('../models/Inventory');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const env = require('../config/environment');

/**
 * URL pública que el cliente comparte por WhatsApp con el asesor. Se calcula
 * al vuelo (mismo criterio que las cotizaciones): si cambia el dominio, los
 * links viejos siguen funcionando.
 */
function shareUrlFor(token) {
  return `${env.clientOrigin}/precotizacion/${token}`;
}

function withShareUrl(request) {
  return { ...request, shareUrl: shareUrlFor(request.token) };
}

const quoteRequestsController = {
  // POST /api/quote-requests — PÚBLICO (desde el carrito, sin sesión)
  create: asyncHandler(async (req, res) => {
    const request = await QuoteRequest.create(req.body);
    res.status(201).json({
      data: {
        token: request.token,
        // Referencia corta que el cliente cita en el chat; ya viene formateada
        // desde el modelo — el frontend nunca la arma.
        folio: request.folio,
        shareUrl: shareUrlFor(request.token),
        estimatedShippingCost: request.estimatedShippingCost,
        estimatedShippingLabel: request.estimatedShippingLabel,
      },
      message: 'Precotización creada',
    });
  }),

  // GET /api/quote-requests/public/:token — PÚBLICO (pantalla de revisión sin sesión)
  publicByToken: asyncHandler(async (req, res) => {
    const request = await QuoteRequest.findByToken(req.params.token);
    if (!request) throw ApiError.notFound('Esta precotización ya no está disponible');
    res.json({
      data: {
        status: request.status,
        folio: request.folio,
        // D7: el contacto es del propio cliente y el token es imposible de
        // adivinar, así que la pantalla de revisión lo muestra (con botón de
        // WhatsApp) para que el asesor conteste sin perseguir el chat.
        customerName: request.customerName,
        customerPhone: request.customerPhone,
        shippingPostalCode: request.shippingPostalCode,
        estimatedSubtotal: request.estimatedSubtotal,
        estimatedShippingCost: request.estimatedShippingCost,
        estimatedShippingLabel: request.estimatedShippingLabel,
        createdAt: request.createdAt,
        expiresAt: request.expiresAt,
        items: (request.items ?? []).map((it) => ({
          productName: it.productName,
          materialLabel: it.materialLabel,
          color: it.color,
          variantSelections: it.variantSelections,
          quantity: it.quantity,
          unitPriceCash: it.unitPriceCash,
          imageUrl: it.imageUrl,
        })),
      },
    });
  }),

  // GET /api/quote-requests — INTERNO. Precotizaciones pendientes (panel).
  list: asyncHandler(async (req, res) => {
    const data = await QuoteRequest.findPending();
    res.json({ data: data.map(withShareUrl) });
  }),

  // GET /api/quote-requests/:token — INTERNO. Detalle + inventario resuelto
  // para precargar el builder de cotizaciones (loadFromRequest).
  getByToken: asyncHandler(async (req, res) => {
    const request = await QuoteRequest.findByToken(req.params.token);
    if (!request) throw ApiError.notFound('Esta precotización ya no está disponible');
    if (request.status === 'converted') {
      throw ApiError.badRequest('Esta precotización ya se convirtió en cotización');
    }
    if (request.status === 'dismissed') {
      throw ApiError.badRequest('Esta precotización fue descartada');
    }
    const productIds = [...new Set((request.items ?? []).map((it) => it.productId))];
    const inventory = await Inventory.search({ productIds });
    res.json({ data: { ...withShareUrl(request), inventory } });
  }),

  // PATCH /api/quote-requests/:token/dismiss — INTERNO
  dismiss: asyncHandler(async (req, res) => {
    const ok = await QuoteRequest.dismiss(req.params.token, req.user.id);
    if (!ok) throw ApiError.badRequest('Esta precotización ya no está pendiente');
    res.json({ message: 'Precotización descartada' });
  }),
};

module.exports = quoteRequestsController;
