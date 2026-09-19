const { pool } = require('../config/database');
const Delivery = require('../models/Delivery');
const Payment = require('../models/Payment');
const Order = require('../models/Order');
const Notification = require('../models/Notification');
const discountEngine = require('../models/discountEngine');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');

/** Entregas que exigen aceptación previa del repartidor antes de tocarlas (plan repartidor-acepta-entrega). */
function assertAccepted(delivery) {
  if (delivery.acceptanceStatus !== 'accepted') {
    throw ApiError.badRequest('Acepta la entrega antes de continuar');
  }
}

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
    // Docs/plan-descuentos.md: al abrir la entrega se apaga el badge de
    // "descuento rechazado" del repartidor, si el rechazo era de él.
    if (delivery.orderId) {
      await discountEngine.acknowledgeRejected('order', delivery.orderId, req.user.id);
    }
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
    assertAccepted(delivery);

    // Para completar se exige firma y foto.
    if (status === 'completed' && (!delivery.signatureImageUrl || !delivery.photoUrl)) {
      throw ApiError.badRequest('Se requiere firma y foto antes de marcar como entregada');
    }

    // No se puede finalizar una entrega con saldo por cobrar: el repartidor
    // debe registrar el cobro antes de marcarla como entregada. Excepciones:
    // - Crédito Tienda (store_credit): el saldo se financia y se paga a
    //   plazos DESPUÉS de la entrega, así que ahí sí es normal cerrar con
    //   saldo.
    // - Apartado (layaway): el cliente puede seguir abonando dentro de los
    //   3 meses (layaway_deadline) y el último pago suele darse hasta
    //   recibir el mueble; el repartidor puede cobrar el saldo restante ahí
    //   mismo (Registrar cobro) pero no es obligatorio para cerrar.
    // En ambos casos el enganche mínimo ya se validó antes de que el pedido
    // saliera a ruta (Order.paymentClearsForDelivery).
    if (status === 'completed' && delivery.paymentMethod !== 'store_credit' && delivery.paymentMethod !== 'layaway') {
      const balance = Number(delivery.totalAmount ?? 0) - Number(delivery.paymentAmount ?? 0);
      if (balance > 0.01) {
        const pend = balance.toLocaleString('es-MX', {
          style: 'currency', currency: 'MXN', minimumFractionDigits: 2,
        });
        throw ApiError.badRequest(
          `No puedes finalizar la entrega: faltan ${pend} por cobrar. `
          + 'Registra el cobro del saldo pendiente antes de marcarla como entregada.',
        );
      }
    }

    const updated = await Delivery.updateStatus(req.params.id, status);
    res.json({ data: updated, message: 'Estado actualizado' });
  }),

  // PATCH /api/delivery/assignments/:id/failed — "No se pudo entregar"
  // (Plan Docs/plan-rastreo-pedido-cliente.md, Hueco 1). Marca la entrega
  // 'failed', anexa el motivo a las notas y regresa el pedido a 'ready'.
  markFailed: asyncHandler(async (req, res) => {
    const reason = String(req.body.reason ?? '').trim();
    if (!reason) throw ApiError.badRequest('Indica el motivo por el que no se pudo entregar');
    const photoUrl = typeof req.body.photoUrl === 'string' && req.body.photoUrl.startsWith('data:image/')
      ? req.body.photoUrl
      : undefined;

    const delivery = await Delivery.findById(req.params.id);
    if (!delivery) throw ApiError.notFound('Entrega no encontrada');
    if (delivery.deliveryPersonId !== req.user.id) throw ApiError.forbidden('Entrega no asignada a ti');
    assertAccepted(delivery);
    if (delivery.deliveryStatus === 'completed') {
      throw ApiError.badRequest('Esta entrega ya está marcada como completada');
    }

    const updated = await Delivery.markFailed(req.params.id, reason, photoUrl);
    res.json({ data: updated, message: 'Se registró el intento de entrega' });
  }),

  // POST /api/delivery/assignments/:id/proof — guarda firma/foto (base64)
  saveProof: asyncHandler(async (req, res) => {
    const delivery = await Delivery.findById(req.params.id);
    if (!delivery) throw ApiError.notFound('Entrega no encontrada');
    if (delivery.deliveryPersonId !== req.user.id) throw ApiError.forbidden('Entrega no asignada a ti');
    assertAccepted(delivery);
    // Entrega ya cerrada: la firma y la foto quedan congeladas, no se pueden
    // reemplazar (el repartidor no puede rayar ni volver a firmar).
    if (delivery.deliveryStatus === 'completed') {
      throw ApiError.badRequest('La entrega ya está completada: la firma no se puede modificar');
    }
    const updated = await Delivery.saveProof(req.params.id, req.body);
    res.json({ data: updated, message: 'Evidencia guardada' });
  }),

  // GET /api/delivery/earnings?period=day|week|month&date=YYYY-MM-DD
  // Entregas completadas del repartidor autenticado y acumulado de armados del periodo.
  earnings: asyncHandler(async (req, res) => {
    const period = ['day', 'week', 'month'].includes(req.query.period) ? req.query.period : 'day';
    const ref = /^\d{4}-\d{2}-\d{2}$/.test(req.query.date || '')
      ? new Date(`${req.query.date}T00:00:00`)
      : new Date();

    const fmt = (d) => {
      const pad = (n) => String(n).padStart(2, '0');
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };

    let from;
    let to;
    if (period === 'day') {
      from = to = fmt(ref);
    } else if (period === 'week') {
      // Semana lunes-domingo que contiene la fecha de referencia.
      const day = (ref.getDay() + 6) % 7; // 0 = lunes
      const start = new Date(ref);
      start.setDate(ref.getDate() - day);
      const end = new Date(start);
      end.setDate(start.getDate() + 6);
      from = fmt(start);
      to = fmt(end);
    } else {
      from = fmt(new Date(ref.getFullYear(), ref.getMonth(), 1));
      to = fmt(new Date(ref.getFullYear(), ref.getMonth() + 1, 0));
    }

    const result = await Delivery.earningsByPerson(req.user.id, { from, to });
    res.json({ data: { period, ...result } });
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
    assertAccepted(delivery);

    const result = await Payment.create(
      { orderId: delivery.orderId, amount, payments, notes: 'Cobro en entrega' },
      req.user.id,
    );
    res.status(201).json({ data: result, message: 'Cobro registrado' });
  }),

  // POST /api/delivery/assignments/:id/discount — el repartidor pide un
  // descuento en dinero (RN-D2: nunca regalo de producto) al notar algo en la
  // entrega (ej. mueble dañado). Se aplica de inmediato y queda 'pending'.
  requestDiscount: asyncHandler(async (req, res) => {
    const delivery = await Delivery.findById(req.params.id);
    if (!delivery) throw ApiError.notFound('Entrega no encontrada');
    if (delivery.deliveryPersonId !== req.user.id) throw ApiError.forbidden('Entrega no asignada a ti');
    assertAccepted(delivery);

    const { amount, reasonCategory, reason } = req.body;
    await Order.applyMoneyDiscount(delivery.orderId, {
      amount, reasonCategory, reason,
      requestedBy: req.user.id,
      requestedByRole: 'delivery_person',
    });
    // Se devuelve con la forma de "entrega" (no la de "pedido"), igual que
    // el resto de este controlador — el repartidor solo conoce assignmentId.
    const updated = await Delivery.findById(req.params.id);
    res.status(201).json({ data: updated, message: 'Descuento aplicado, pendiente de aprobación' });
  }),

  // POST /api/delivery/assignments/:id/share — emite el link del ticket para
  // mandárselo al cliente por WhatsApp desde la entrega.
  //
  // Existe como espejo de POST /api/seller/orders/:id/share porque aquel está
  // detrás de authorize('seller','admin') y el repartidor recibiría 403.
  //
  // Entra por assignmentId y NO por orderId a propósito: así el repartidor no
  // puede sondear pedidos ajenos cambiando el número de la URL. La
  // comprobación de propiedad es la misma que en registerPayment.
  //
  // No genera un ticket nuevo: la página pública lee datos en vivo, así que el
  // token que ya existía (si el vendedor lo compartió al crear el pedido) sirve
  // igual y ya refleja el cobro recién registrado.
  share: asyncHandler(async (req, res) => {
    const delivery = await Delivery.findById(req.params.id);
    if (!delivery) throw ApiError.notFound('Entrega no encontrada');
    if (delivery.deliveryPersonId !== req.user.id) {
      throw ApiError.forbidden('Entrega no asignada a ti');
    }

    const token = await Order.ensureShareToken(delivery.orderId);
    if (!token) throw ApiError.notFound('Pedido no encontrado');
    res.json({ data: { token } });
  }),

  /**
   * PATCH /api/delivery/route/reorder — el repartidor reordena SU propia
   * ruta del día (plan agenda-agregar-orden-de-entrega). `deliveryIds` son
   * ids de entrega en el orden final deseado; se verifica que todas
   * pertenezcan a quien llama antes de tocar nada — nunca se confía en lo
   * que mande el body.
   */
  reorderRoute: asyncHandler(async (req, res) => {
    const { deliveryIds } = req.body ?? {};
    if (!Array.isArray(deliveryIds) || deliveryIds.length === 0) {
      throw ApiError.badRequest('deliveryIds debe ser un arreglo con al menos un elemento');
    }
    const ids = deliveryIds.map(Number);
    const owners = await Delivery.findOwnersByIds(ids);
    if (owners.length !== ids.length || owners.some((o) => o.deliveryPersonId !== req.user.id)) {
      throw ApiError.forbidden('Una o más entregas no están asignadas a ti');
    }
    await Delivery.reorderRoute(ids);
    res.json({ message: 'Ruta reordenada' });
  }),

  /**
   * PATCH /api/delivery/assignments/:id/window — el repartidor ajusta SOLO
   * la hora de su parada (plan agenda-agregar-orden-de-entrega). A propósito
   * no acepta fecha ni `deliveryCommitment`: eso lo sigue manejando
   * admin/vendedor vía "Reprogramar" (que exige motivo cuando aplica); esto
   * es solo un ajuste operativo de la hora dentro del mismo día.
   */
  updateWindow: asyncHandler(async (req, res) => {
    const delivery = await Delivery.findById(req.params.id);
    if (!delivery) throw ApiError.notFound('Entrega no encontrada');
    if (delivery.deliveryPersonId !== req.user.id) {
      throw ApiError.forbidden('Entrega no asignada a ti');
    }
    assertAccepted(delivery);
    const { deliveryWindowStart, deliveryWindowEnd } = req.body ?? {};
    const order = await Order.updateDeliveryWindow(delivery.orderId, {
      deliveryWindowStart: deliveryWindowStart || null,
      deliveryWindowEnd: deliveryWindowEnd || null,
    });
    res.json({ data: order, message: 'Horario actualizado' });
  }),

  /**
   * PATCH /api/delivery/assignments/:id/accept — el repartidor confirma que
   * va a hacer esta entrega. A partir de aquí admin/vendedor ya no pueden
   * reasignarla (Order.assignDeliveryPerson) y el repartidor puede tocar
   * evidencia/cobro/estado (assertAccepted arriba).
   */
  accept: asyncHandler(async (req, res) => {
    const delivery = await Delivery.findById(req.params.id);
    if (!delivery) throw ApiError.notFound('Entrega no encontrada');
    if (delivery.deliveryPersonId !== req.user.id) throw ApiError.forbidden('Entrega no asignada a ti');
    const updated = await Delivery.accept(req.params.id);
    res.json({ data: updated, message: 'Entrega aceptada' });
  }),

  /**
   * POST /api/delivery/assignments/:id/reject — el repartidor no puede/quiere
   * hacer esta entrega. Sigue asignada a él hasta que admin/vendedor la
   * reasignen (avisados aquí por campana); el motivo es obligatorio.
   */
  reject: asyncHandler(async (req, res) => {
    const reason = String(req.body?.reason ?? '').trim();
    if (!reason) throw ApiError.badRequest('Indica el motivo del rechazo');

    const delivery = await Delivery.findById(req.params.id);
    if (!delivery) throw ApiError.notFound('Entrega no encontrada');
    if (delivery.deliveryPersonId !== req.user.id) throw ApiError.forbidden('Entrega no asignada a ti');
    if (delivery.acceptanceStatus === 'accepted') {
      throw ApiError.badRequest('Ya aceptaste esta entrega: pide al admin o al vendedor que la reasigne');
    }

    const updated = await Delivery.reject(req.params.id, reason);

    const [[me]] = await pool.execute('SELECT full_name FROM users WHERE id = ?', [req.user.id]);
    const repartidorName = me?.full_name || `usuario #${req.user.id}`;
    const title = `${repartidorName} rechazó la entrega de ${delivery.orderNumber}`;
    const body = `Motivo: ${reason}. Reasigna la entrega desde la agenda de entregas.`;
    await Notification.create({
      audience: 'admin', type: 'delivery_rejected', title, body, orderId: delivery.orderId,
    });
    const [[order]] = await pool.execute('SELECT seller_id FROM orders WHERE id = ?', [delivery.orderId]);
    if (order?.seller_id) {
      await Notification.create({
        audience: 'seller', userId: order.seller_id, type: 'delivery_rejected', title, body, orderId: delivery.orderId,
      });
    }

    res.json({ data: updated, message: 'Rechazo registrado' });
  }),
};

module.exports = deliveryController;
