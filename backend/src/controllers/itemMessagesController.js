const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { pool } = require('../config/database');
const OrderItemMessage = require('../models/OrderItemMessage');
const Notification = require('../models/Notification');

/**
 * Chat por línea de pedido (Docs — mensajes vendedor/admin/fabricante debajo
 * de cada producto en fabricación). Un mismo controlador sirve a los tres
 * portales (montado en adminRoutes, sellerRoutes y manufacturerRoutes); la
 * autorización se resuelve por `req.user.role`, no por la ruta que matcheó
 * (sellerRoutes y manufacturerRoutes también aceptan admin como superusuario).
 */

async function loadItemContext(itemId) {
  const [[row]] = await pool.execute(
    `SELECT oi.id, oi.order_id, oi.product_name, oi.manufacturer_id,
            o.order_number, o.seller_id
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
      WHERE oi.id = ?`,
    [itemId],
  );
  return row ?? null;
}

/** Vendedores y admins ven cualquier pedido (ya son compartidos); el
 * fabricante solo el suyo — ve el hilo de una línea si se la asignaron. */
async function assertCanAccess(req, item) {
  if (!item) throw ApiError.notFound('Producto no encontrado');
  if (req.user.role === 'admin' || req.user.role === 'seller') return;
  if (req.user.role === 'manufacturer') {
    const [[row]] = await pool.execute('SELECT manufacturer_id FROM users WHERE id = ?', [req.user.id]);
    if (!row?.manufacturer_id || row.manufacturer_id !== item.manufacturer_id) {
      throw ApiError.forbidden('No puedes ver los mensajes de este producto');
    }
    return;
  }
  throw ApiError.forbidden('No autorizado');
}

const itemMessagesController = {
  // GET /{admin|seller|manufacturer}/order-items/:itemId/messages
  list: asyncHandler(async (req, res) => {
    const itemId = Number(req.params.itemId);
    const item = await loadItemContext(itemId);
    await assertCanAccess(req, item);
    const data = await OrderItemMessage.listForItem(itemId);
    res.json({ data });
  }),

  // POST /{admin|seller|manufacturer}/order-items/:itemId/messages { body }
  create: asyncHandler(async (req, res) => {
    const itemId = Number(req.params.itemId);
    const item = await loadItemContext(itemId);
    await assertCanAccess(req, item);

    const body = String(req.body?.body ?? '').trim();
    if (!body) throw ApiError.badRequest('Escribe un mensaje');
    if (body.length > 1000) throw ApiError.badRequest('El mensaje es muy largo (máx. 1000 caracteres)');

    const [[user]] = await pool.execute('SELECT full_name FROM users WHERE id = ?', [req.user.id]);

    const message = await OrderItemMessage.create({
      orderItemId: itemId,
      orderId: item.order_id,
      senderId: req.user.id,
      senderRole: req.user.role,
      senderName: user?.full_name ?? 'Usuario',
      body,
    });

    // Avisa a quien NO escribió (los otros 2 roles), nunca al remitente.
    const title = `Nuevo mensaje · ${item.product_name}`;
    const preview = body.length > 140 ? `${body.slice(0, 140)}…` : body;
    const notify = (n) => Notification.create({ ...n, type: 'item_message', title, body: preview, orderId: item.order_id, orderItemId: itemId });

    if (req.user.role !== 'admin') {
      await notify({ audience: 'admin' });
    }
    if (req.user.role !== 'seller' && item.seller_id) {
      await notify({ audience: 'seller', userId: item.seller_id });
    }
    if (req.user.role !== 'manufacturer' && item.manufacturer_id) {
      await notify({ audience: 'manufacturer', manufacturerId: item.manufacturer_id });
    }

    res.status(201).json({ data: message });
  }),
};

module.exports = itemMessagesController;
