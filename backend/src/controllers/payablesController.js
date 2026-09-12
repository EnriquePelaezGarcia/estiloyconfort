const ManufacturerPayable = require('../models/ManufacturerPayable');
const Notification = require('../models/Notification');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { periodFromQuery } = require('../utils/periods');

/**
 * Cuentas por pagar a fabricantes (solo admin).
 *
 * El portal del fabricante consume los MISMOS métodos del modelo desde
 * manufacturerController, forzando su propio manufacturerId. Ver el
 * guardarraíl D14 documentado en models/ManufacturerPayable.js.
 */
const payablesController = {
  // GET /api/payables — saldo por fabricante
  summary: asyncHandler(async (req, res) => {
    // Sin período explícito se ve el saldo HISTÓRICO completo: un adeudo no
    // desaparece porque cambie el mes.
    const hasRange = req.query.period || req.query.from || req.query.to;
    const range = hasRange ? periodFromQuery(req.query) : { from: null, to: null };
    const result = await ManufacturerPayable.summaryByManufacturer({
      from: range.from,
      to: range.to,
    });
    res.json({ data: result.data, meta: { total: result.total, from: range.from, to: range.to } });
  }),

  // GET /api/payables/documents
  documents: asyncHandler(async (req, res) => {
    const hasRange = req.query.period || req.query.from || req.query.to;
    const range = hasRange ? periodFromQuery(req.query) : { period: 'all', from: null, to: null };
    const documents = await ManufacturerPayable.documentsFor({
      manufacturerId: req.query.manufacturerId,
      from: range.from,
      to: range.to,
      dateBasis: req.query.dateBasis === 'ordered' ? 'ordered' : 'delivered',
      sourceType: req.query.sourceType,
      fabricationStatus: req.query.fabricationStatus,
      paymentStatus: req.query.paymentStatus,
    });
    res.json({
      data: documents,
      meta: {
        period: range.period,
        from: range.from,
        to: range.to,
        summary: ManufacturerPayable.summarize(documents),
      },
    });
  }),

  // GET /api/payables/documents/:sourceType/:sourceId?manufacturerId=
  documentDetail: asyncHandler(async (req, res) => {
    const { sourceType, sourceId } = req.params;
    if (!['order', 'purchase_order'].includes(sourceType)) {
      throw ApiError.badRequest('Tipo de documento inválido');
    }
    if (!req.query.manufacturerId) throw ApiError.badRequest('Falta el fabricante');
    const detail = await ManufacturerPayable.documentDetail(
      sourceType,
      sourceId,
      req.query.manufacturerId,
    );
    if (!detail) throw ApiError.notFound('Documento no encontrado para este fabricante');
    res.json({ data: detail });
  }),

  // GET /api/payables/cut?manufacturerId&period — propuesta de corte
  cut: asyncHandler(async (req, res) => {
    if (!req.query.manufacturerId) throw ApiError.badRequest('Falta el fabricante');
    const hasRange = req.query.period || req.query.from || req.query.to;
    const range = hasRange ? periodFromQuery(req.query) : { period: 'all', from: null, to: null };
    const result = await ManufacturerPayable.pendingCut(req.query.manufacturerId, {
      from: range.from,
      to: range.to,
    });
    res.json({
      data: result.documents,
      meta: { period: range.period, from: range.from, to: range.to, summary: result.summary },
    });
  }),

  // POST /api/payables/batches — registra el pago/corte
  createBatch: asyncHandler(async (req, res) => {
    if (!req.body.manufacturerId) throw ApiError.badRequest('Falta el fabricante');
    if (!req.body.paymentDate) throw ApiError.badRequest('La fecha de pago es obligatoria');
    const batch = await ManufacturerPayable.createBatch(req.body, req.user.id);
    res.status(201).json({ data: batch, message: 'Pago registrado' });
  }),

  // GET /api/payables/batches
  listBatches: asyncHandler(async (req, res) => {
    const hasRange = req.query.period || req.query.from || req.query.to;
    const range = hasRange ? periodFromQuery(req.query) : { from: null, to: null };
    const data = await ManufacturerPayable.listBatches({
      manufacturerId: req.query.manufacturerId,
      from: range.from,
      to: range.to,
    });
    const total = data.reduce((sum, b) => sum + b.totalAmount, 0);
    res.json({ data, meta: { total: Math.round(total * 100) / 100, count: data.length } });
  }),

  removeBatch: asyncHandler(async (req, res) => {
    const ok = await ManufacturerPayable.removeBatch(req.params.id);
    if (!ok) throw ApiError.notFound('Pago no encontrado');
    res.json({ message: 'Pago eliminado' });
  }),

  // POST /api/payables/batches/:id/send-receipt — botón manual, nunca automático.
  sendReceipt: asyncHandler(async (req, res) => {
    await ManufacturerPayable.emailReceipt(req.params.id);
    res.json({ message: 'Recibo enviado por correo' });
  }),

  // POST /api/payables/statements — genera y archiva el estado de cuenta del periodo.
  createStatement: asyncHandler(async (req, res) => {
    if (!req.body.manufacturerId) throw ApiError.badRequest('Falta el fabricante');
    if (!req.body.periodFrom || !req.body.periodTo) throw ApiError.badRequest('Falta el periodo');
    const statement = await ManufacturerPayable.createStatement(req.body, req.user.id);
    res.status(201).json({ data: statement, message: 'Estado de cuenta generado' });
  }),

  // GET /api/payables/statements?manufacturerId= — historial archivado
  listStatements: asyncHandler(async (req, res) => {
    if (!req.query.manufacturerId) throw ApiError.badRequest('Falta el fabricante');
    const data = await ManufacturerPayable.listStatements(req.query.manufacturerId);
    res.json({ data });
  }),

  // POST /api/payables/statements/:id/send-email — botón manual.
  sendStatementEmail: asyncHandler(async (req, res) => {
    await ManufacturerPayable.emailStatement(req.params.id);
    res.json({ message: 'Estado de cuenta enviado por correo' });
  }),

  // POST /api/payables/charges — cargo manual o nota de crédito
  // `approveNow` (default true para el admin): lo aplica al saldo de inmediato.
  // Si va en false, queda 'pending' y aparece en el módulo Aprobaciones.
  addCharge: asyncHandler(async (req, res) => {
    const approveNow = req.body.approveNow !== false;
    const charge = await ManufacturerPayable.addCharge({
      ...req.body,
      status: approveNow ? 'approved' : 'pending',
      requestedById: req.user.id,
      requestedByRole: 'admin',
    }, req.user.id);
    res.status(201).json({
      data: charge,
      message: approveNow ? 'Cargo registrado' : 'Cargo enviado a Aprobaciones',
    });
  }),

  removeCharge: asyncHandler(async (req, res) => {
    const ok = await ManufacturerPayable.removeCharge(req.params.id);
    if (!ok) throw ApiError.notFound('Cargo no encontrado');
    res.json({ message: 'Cargo eliminado' });
  }),

  // PATCH /api/payables/charges/:id/approve  { amount? }
  approveCharge: asyncHandler(async (req, res) => {
    const amount = req.body.amount != null ? Number(req.body.amount) : null;
    const charge = await ManufacturerPayable.approveChargeRequest(req.params.id, req.user.id, amount);
    await notifyManufacturerCharge(charge, 'approved');
    res.json({ data: { id: charge.id }, message: 'Cargo aprobado' });
  }),

  // PATCH /api/payables/charges/:id/reject  { reviewNote }
  rejectCharge: asyncHandler(async (req, res) => {
    const charge = await ManufacturerPayable.rejectChargeRequest(
      req.params.id, req.user.id, req.body.reviewNote,
    );
    await notifyManufacturerCharge(charge, 'rejected');
    res.json({ data: { id: charge.id }, message: 'Cargo rechazado' });
  }),
};

/** Avisa al fabricante que su solicitud de ajuste se resolvió. */
async function notifyManufacturerCharge(charge, outcome) {
  if (!charge.manufacturer_id || charge.requested_by_role !== 'manufacturer') return;
  const amount = Math.abs(Number(charge.amount)).toFixed(2);
  await Notification.create({
    audience: 'manufacturer',
    manufacturerId: charge.manufacturer_id,
    type: outcome === 'approved' ? 'manufacturer_charge_approved' : 'manufacturer_charge_rejected',
    title: outcome === 'approved'
      ? `La tienda aprobó tu ajuste de $${amount}`
      : `La tienda rechazó tu ajuste de $${amount}`,
    body: outcome === 'rejected' ? (charge.review_note ?? null) : charge.concept,
  });
}

module.exports = payablesController;
