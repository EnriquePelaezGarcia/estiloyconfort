const ManufacturerPayable = require('../models/ManufacturerPayable');
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

  // POST /api/payables/charges — cargo manual o nota de crédito
  addCharge: asyncHandler(async (req, res) => {
    const charge = await ManufacturerPayable.addCharge(req.body, req.user.id);
    res.status(201).json({ data: charge, message: 'Cargo registrado' });
  }),

  removeCharge: asyncHandler(async (req, res) => {
    const ok = await ManufacturerPayable.removeCharge(req.params.id);
    if (!ok) throw ApiError.notFound('Cargo no encontrado');
    res.json({ message: 'Cargo eliminado' });
  }),
};

module.exports = payablesController;
