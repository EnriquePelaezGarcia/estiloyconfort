const Material = require('../models/Material');
const { pool } = require('../config/database');

/**
 * Catálogo de materiales (M1, M8). El ABC vive bajo /admin; el catálogo
 * activo también se expone público bajo /materials porque el bootstrap del
 * frontend (MaterialsStore, Fase 4) lo necesita sin ser admin.
 */
const materialsController = {
  // GET /api/materials — catálogo activo, para todos los roles.
  async getActive(req, res, next) {
    try {
      const data = await Material.findAll({ includeInactive: false });
      res.json({ data });
    } catch (err) { next(err); }
  },

  // GET /api/admin/materials?includeInactive=true
  async getAll(req, res, next) {
    try {
      const data = await Material.findAll({ includeInactive: req.query.includeInactive === 'true' });
      res.json({ data });
    } catch (err) { next(err); }
  },

  // GET /api/admin/materials/:id/usage — "usado en N productos, M pedidos" (M8).
  async getUsage(req, res, next) {
    try {
      const material = await Material.findById(req.params.id);
      if (!material) return res.status(404).json({ message: 'Material no encontrado' });
      const usage = await Material.usage(req.params.id);
      res.json({ data: usage });
    } catch (err) { next(err); }
  },

  async create(req, res, next) {
    try {
      const { code, label, colorPolicy, fixedColor, wholesaleFactor, sortOrder } = req.body;
      if (!code || !label) {
        return res.status(400).json({ message: 'code y label son obligatorios.' });
      }
      const allowedPolicies = ['free', 'fixed', 'required'];
      if (colorPolicy && !allowedPolicies.includes(colorPolicy)) {
        return res.status(400).json({ message: 'color_policy debe ser free, fixed o required.' });
      }
      if (colorPolicy === 'fixed' && !fixedColor) {
        return res.status(400).json({ message: 'Un material con color_policy=fixed necesita fixedColor.' });
      }
      const existing = await Material.findByCode(code);
      if (existing) return res.status(400).json({ message: `Ya existe un material con code "${code}".` });

      const material = await Material.create({
        code, label, colorPolicy: colorPolicy || 'free', fixedColor, wholesaleFactor, sortOrder,
      });
      res.status(201).json({ data: material, message: 'Material creado' });
    } catch (err) { next(err); }
  },

  async update(req, res, next) {
    try {
      const material = await Material.findById(req.params.id);
      if (!material) return res.status(404).json({ message: 'Material no encontrado' });

      const { label, colorPolicy, fixedColor, wholesaleFactor, sortOrder } = req.body;
      const allowedPolicies = ['free', 'fixed', 'required'];
      if (colorPolicy && !allowedPolicies.includes(colorPolicy)) {
        return res.status(400).json({ message: 'color_policy debe ser free, fixed o required.' });
      }
      if ((colorPolicy ?? material.colorPolicy) === 'fixed' && !(fixedColor ?? material.fixedColor)) {
        return res.status(400).json({ message: 'Un material con color_policy=fixed necesita fixedColor.' });
      }

      const updated = await Material.update(req.params.id, {
        label, color_policy: colorPolicy, fixed_color: fixedColor, wholesale_factor: wholesaleFactor, sort_order: sortOrder,
      });
      res.json({ data: updated, message: 'Material actualizado' });
    } catch (err) { next(err); }
  },

  // M8: nunca DELETE real — se desactiva/activa.
  async deactivate(req, res, next) {
    try {
      const material = await Material.findById(req.params.id);
      if (!material) return res.status(404).json({ message: 'Material no encontrado' });
      const updated = await Material.deactivate(req.params.id);
      res.json({ data: updated, message: 'Material desactivado' });
    } catch (err) { next(err); }
  },

  async activate(req, res, next) {
    try {
      const material = await Material.findById(req.params.id);
      if (!material) return res.status(404).json({ message: 'Material no encontrado' });
      const updated = await Material.activate(req.params.id);
      res.json({ data: updated, message: 'Material activado' });
    } catch (err) { next(err); }
  },

  /**
   * GET /api/admin/pricing-gaps — materiales declarados (product_materials)
   * sin costo capturado por ningún fabricante (M2): el hueco de captura que
   * antes era invisible ("el producto simplemente no aparece cotizado").
   */
  async getPricingGaps(req, res, next) {
    try {
      const [rows] = await pool.execute(
        `SELECT p.id AS product_id, p.name AS product_name, p.sku,
                mat.id AS material_id, mat.code, mat.label
           FROM product_materials pm
           JOIN products p ON p.id = pm.product_id AND p.is_active = TRUE
           JOIN materials mat ON mat.id = pm.material_id
           LEFT JOIN product_material_prices mp
                  ON mp.product_id = pm.product_id AND mp.material_id = pm.material_id
          WHERE pm.is_active = TRUE AND (mp.base_cost IS NULL)
          ORDER BY p.name, mat.sort_order`,
      );
      res.json({
        data: rows.map((r) => ({
          productId: r.product_id,
          productName: r.product_name,
          sku: r.sku,
          materialId: r.material_id,
          materialCode: r.code,
          materialLabel: r.label,
        })),
      });
    } catch (err) { next(err); }
  },
};

module.exports = materialsController;
