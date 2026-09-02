const Notification = require('../models/Notification');
const asyncHandler = require('../utils/asyncHandler');
const { pool } = require('../config/database');

/**
 * Notificaciones in-app compartidas por los tres portales
 * (Docs/plan-fabricante-notificaciones-y-aceptacion.md D4 + ampliación UAT).
 *
 * El destinatario sale del rol del token, nunca del cuerpo:
 *   - admin        → todas las de audiencia 'admin' (global).
 *   - seller       → las de audiencia 'seller' dirigidas a su usuario.
 *   - manufacturer → las de su fabricante (todas sus cuentas ven lo mismo).
 */
async function filterFor(req) {
  if (req.user.role === 'admin') return { audience: 'admin' };
  if (req.user.role === 'seller') return { audience: 'seller', userId: req.user.id };
  const [[row]] = await pool.execute(
    'SELECT manufacturer_id FROM users WHERE id = ?',
    [req.user.id],
  );
  return { audience: 'manufacturer', manufacturerId: row?.manufacturer_id ?? -1 };
}

const notificationsController = {
  // GET /notifications?before=&limit=
  list: asyncHandler(async (req, res) => {
    const filter = await filterFor(req);
    const data = await Notification.list(filter, {
      limit: Number(req.query.limit) || 30,
      before: req.query.before ? Number(req.query.before) : null,
    });
    res.json({ data });
  }),

  // GET /notifications/unread-count
  unreadCount: asyncHandler(async (req, res) => {
    const filter = await filterFor(req);
    res.json({ data: { count: await Notification.unreadCount(filter) } });
  }),

  // PATCH /notifications/:id/read
  markRead: asyncHandler(async (req, res) => {
    const filter = await filterFor(req);
    await Notification.markRead(req.params.id, filter);
    res.json({ data: { count: await Notification.unreadCount(filter) } });
  }),

  // PATCH /notifications/read-all
  markAllRead: asyncHandler(async (req, res) => {
    const filter = await filterFor(req);
    const marked = await Notification.markAllRead(filter);
    res.json({ data: { marked, count: 0 } });
  }),
};

module.exports = notificationsController;
