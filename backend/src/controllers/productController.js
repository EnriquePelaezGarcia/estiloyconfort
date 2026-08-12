const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const Product = require('../models/Product');
const ProductManufacturerCost = require('../models/ProductManufacturerCost');
const PricingConfig = require('../models/PricingConfig');
const { calculatePrices, marginFromCashPrice } = require('../utils/pricingCalculator');
const { syncMaterialPricesAndReprice } = require('../utils/productPricing');

/**
 * Arma la respuesta de costos por fabricante de un producto EN LOS
 * MATERIALES QUE DECLARA (M2, M3). Cada fabricante trae su costo por
 * material declarado y la utilidad que deja (RN-12…RN-15);
 * ProductManufacturerCost ya resuelve `isBaseCost` por material (RN-02) y
 * deja `cost: null` donde el fabricante no cotiza ese material (RN-03) o
 * donde nadie lo ha capturado todavía (el hueco de M2).
 */
async function manufacturerPricesPayload(productId) {
  const [[product]] = await pool.execute(
    'SELECT id, margin_percentage FROM products WHERE id = ?',
    [productId],
  );
  if (!product) return null;

  const [manufacturerCosts, declaredMaterials] = await Promise.all([
    ProductManufacturerCost.findByProduct(productId),
    Product.getDeclaredMaterials(productId),
  ]);

  const [priceRows] = await pool.execute(
    'SELECT material_id, base_cost, price_cash, price_6msi, price_credit, price_mayoreo FROM product_material_prices WHERE product_id = ?',
    [productId],
  );
  const priceByMaterial = new Map(priceRows.map((r) => [r.material_id, r]));

  const materials = {};
  for (const m of declaredMaterials) {
    const row = priceByMaterial.get(m.materialId);
    materials[m.materialId] = row
      ? {
        code: m.code,
        label: m.label,
        baseCost: row.base_cost != null ? Number(row.base_cost) : null,
        priceCash: row.price_cash != null ? Number(row.price_cash) : null,
        price6msi: row.price_6msi != null ? Number(row.price_6msi) : null,
        priceCredit: row.price_credit != null ? Number(row.price_credit) : null,
        priceMayoreo: row.price_mayoreo != null ? Number(row.price_mayoreo) : null,
        isQuoted: row.base_cost != null,
      }
      : {
        code: m.code, label: m.label,
        baseCost: null, priceCash: null, price6msi: null, priceCredit: null, priceMayoreo: null,
        isQuoted: false,
      };
  }

  return { data: manufacturerCosts, materials, marginPercentage: Number(product.margin_percentage) };
}

const productController = {
  async getAll(req, res, next) {
    try {
      const { category, search, minPrice, maxPrice, featured, includeInactive, page, limit, sort } = req.query;
      const result = await Product.findAll({
        categoryId: category,
        search,
        minPrice,
        maxPrice,
        featured: featured !== undefined ? featured === 'true' : undefined,
        includeInactive: includeInactive === 'true',
        page: page || 1,
        limit: limit || 12,
        sort,
      });
      res.json(result);
    } catch (err) { next(err); }
  },

  async getOne(req, res, next) {
    try {
      const product = isNaN(req.params.id)
        ? await Product.findBySlug(req.params.id)
        : await Product.findById(req.params.id);
      if (!product) return res.status(404).json({ message: 'Producto no encontrado' });
      res.json({ data: product });
    } catch (err) { next(err); }
  },

  async search(req, res, next) {
    try {
      const { q } = req.query;
      if (!q || q.trim().length < 2) return res.json({ data: [] });
      const results = await Product.search(q.trim());
      res.json({ data: results });
    } catch (err) { next(err); }
  },

  async create(req, res, next) {
    try {
      // Sin retrocompatibilidad (M14): base_cost/price_cash/price_6msi/price_credit
      // ya no existen en products, el body viejo se ignora explícitamente.
      // materialIds se declara aparte con PUT /api/products/:id/materials (Fase 3);
      // si llega inline aquí también se respeta, por comodidad del cliente.
      // eslint-disable-next-line no-unused-vars
      const { base_cost, price_cash, price_6msi, price_credit, materialIds, material, stock_quantity, ...data } = req.body;
      if (data.margin_percentage !== undefined) {
        const m = Number(data.margin_percentage);
        if (!Number.isFinite(m) || m < 0 || m >= 100) {
          return res.status(400).json({
            message: 'El % de ganancia debe estar entre 0 y 99.99. Un valor >= 100 produce precios negativos.',
          });
        }
      }
      const product = await Product.create(data, Array.isArray(materialIds) ? materialIds : []);
      res.status(201).json({ data: product, message: 'Producto creado exitosamente' });
    } catch (err) { next(err); }
  },

  async update(req, res, next) {
    try {
      // eslint-disable-next-line no-unused-vars
      const { base_cost, price_cash, price_6msi, price_credit, materialIds, material, stock_quantity, ...data } = req.body;
      if (data.margin_percentage !== undefined) {
        const m = Number(data.margin_percentage);
        if (!Number.isFinite(m) || m < 0 || m >= 100) {
          return res.status(400).json({
            message: 'El % de ganancia debe estar entre 0 y 99.99. Un valor >= 100 produce precios negativos.',
          });
        }
      }
      const product = await Product.update(req.params.id, data, Array.isArray(materialIds) ? materialIds : null);
      if (!product) return res.status(404).json({ message: 'Producto no encontrado' });
      if (data.margin_percentage !== undefined) {
        await syncMaterialPricesAndReprice(product.id);
      }
      res.json({ data: product, message: 'Producto actualizado' });
    } catch (err) { next(err); }
  },

  async remove(req, res, next) {
    try {
      await Product.delete(req.params.id);
      res.json({ message: 'Producto desactivado exitosamente' });
    } catch (err) { next(err); }
  },

  // ===== Materiales del producto (M2) =====

  async getMaterials(req, res, next) {
    try {
      const materials = await Product.getDeclaredMaterials(req.params.id);
      res.json({ data: materials });
    } catch (err) { next(err); }
  },

  /** PUT /api/products/:id/materials — body: { materialIds: number[] } (M2). */
  async setMaterials(req, res, next) {
    try {
      const { materialIds } = req.body;
      if (!Array.isArray(materialIds)) {
        return res.status(400).json({ message: 'El body debe traer "materialIds": number[].' });
      }
      const product = await Product.update(req.params.id, {}, materialIds);
      if (!product) return res.status(404).json({ message: 'Producto no encontrado' });
      const materials = await Product.getDeclaredMaterials(req.params.id);
      res.json({ data: materials, message: 'Materiales del producto actualizados' });
    } catch (err) { next(err); }
  },

  // ===== Imágenes =====

  async addImage(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'Se requiere un archivo de imagen' });
      }

      const [[{ cnt }]] = await pool.execute(
        'SELECT COUNT(*) AS cnt FROM product_images WHERE product_id = ?',
        [req.params.id]
      );

      const baseUrl = `${req.protocol}://${req.get('host')}`;
      const image_url = `${baseUrl}/uploads/products/${req.file.filename}`;

      const image = await Product.addImage(req.params.id, {
        image_url,
        alt_text: req.body.alt_text || '',
        is_primary: cnt === 0,
        order_display: cnt,
      });

      res.status(201).json({ data: image, message: 'Imagen agregada' });
    } catch (err) { next(err); }
  },

  async deleteImage(req, res, next) {
    try {
      const image = await Product.deleteImage(req.params.id, req.params.imageId);
      if (!image) return res.status(404).json({ message: 'Imagen no encontrada' });

      // Eliminar archivo físico (best-effort)
      try {
        const url = new URL(image.image_url);
        const filename = path.basename(url.pathname);
        const filePath = path.join(__dirname, '../../uploads/products', filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch (_) {}

      res.json({ message: 'Imagen eliminada' });
    } catch (err) { next(err); }
  },

  async setPrimaryImage(req, res, next) {
    try {
      const image = await Product.setPrimaryImage(req.params.id, req.params.imageId);
      if (!image) return res.status(404).json({ message: 'Imagen no encontrada' });
      res.json({ data: image, message: 'Imagen principal actualizada' });
    } catch (err) { next(err); }
  },

  // ===== Costos por fabricante =====

  /**
   * Los materiales declarados de un producto con costo base y los 4 precios
   * finales, SIN el detalle por fabricante (a diferencia de getManufacturerPrices).
   * Pensado para vendedor/POS: necesita el precio, no la composición de costos.
   */
  async getMaterialPrices(req, res, next) {
    try {
      const declared = await Product.getDeclaredMaterials(req.params.id);
      if (!declared.length) return res.status(404).json({ message: 'Producto no encontrado o sin materiales declarados' });

      const [rows] = await pool.execute(
        'SELECT material_id, base_cost, price_cash, price_6msi, price_credit, price_mayoreo FROM product_material_prices WHERE product_id = ?',
        [req.params.id],
      );
      const byMaterial = new Map(rows.map((r) => [r.material_id, r]));

      const data = declared.filter((m) => m.isActive).map((m) => {
        const row = byMaterial.get(m.materialId);
        const isQuoted = !!row && row.base_cost != null;
        return {
          materialId: m.materialId,
          code: m.code,
          label: m.label,
          estado: isQuoted ? 'cotizado' : 'no_aplica',
          baseCost: isQuoted ? Number(row.base_cost) : null,
          priceCash: isQuoted ? Number(row.price_cash) : null,
          price6msi: isQuoted && row.price_6msi != null ? Number(row.price_6msi) : null,
          priceCredit: isQuoted && row.price_credit != null ? Number(row.price_credit) : null,
          priceMayoreo: isQuoted && row.price_mayoreo != null ? Number(row.price_mayoreo) : null,
        };
      });
      res.json({ data });
    } catch (err) { next(err); }
  },

  async getManufacturerPrices(req, res, next) {
    try {
      const payload = await manufacturerPricesPayload(req.params.id);
      if (!payload) return res.status(404).json({ message: 'Producto no encontrado' });
      res.json(payload);
    } catch (err) { next(err); }
  },

  /**
   * PUT /api/products/:id/manufacturer-costs/:manufacturerId
   * Body: { costs: [{ materialId, cost, affectsBaseCost }] }. Sustituye al
   * body de 3 claves fijas (D8/M14: sin retrocompatibilidad).
   */
  async setManufacturerPrice(req, res, next) {
    try {
      const { id, manufacturerId } = req.params;
      const { costs } = req.body;
      if (!Array.isArray(costs) || !costs.length) {
        return res.status(400).json({
          message: 'El body debe traer "costs": [{ materialId, cost, affectsBaseCost }].',
        });
      }

      const declared = await Product.getDeclaredMaterials(id);
      const declaredIds = new Set(declared.map((m) => m.materialId));

      const parsedCosts = [];
      let anyCost = false;
      for (const entry of costs) {
        const materialId = Number(entry?.materialId);
        if (!declaredIds.has(materialId)) {
          return res.status(400).json({
            message: `El material ${entry?.materialId} no está declarado para este producto (Admin → Materiales del producto).`,
          });
        }
        const raw = entry.cost;
        if (raw === null || raw === undefined || raw === '') {
          parsedCosts.push({ materialId, cost: null, affectsBaseCost: entry.affectsBaseCost !== false });
          continue;
        }
        const value = Number(raw);
        if (!Number.isFinite(value) || value <= 0) {
          return res.status(400).json({
            message: 'El costo debe ser mayor a 0. Deja el campo vacío/null si el fabricante no hace este mueble en ese material.',
          });
        }
        parsedCosts.push({ materialId, cost: value, affectsBaseCost: entry.affectsBaseCost !== false });
        anyCost = true;
      }
      if (!anyCost) {
        return res.status(400).json({ message: 'Se debe capturar al menos un costo en algún material.' });
      }

      const [[product]] = await pool.execute('SELECT id FROM products WHERE id = ?', [id]);
      if (!product) return res.status(404).json({ message: 'Producto no encontrado' });

      const [[manufacturer]] = await pool.execute(
        'SELECT id FROM manufacturers WHERE id = ? AND is_active = TRUE',
        [manufacturerId],
      );
      if (!manufacturer) return res.status(404).json({ message: 'Fabricante no encontrado o inactivo' });

      await ProductManufacturerCost.upsert(id, manufacturerId, parsedCosts);
      const payload = await manufacturerPricesPayload(id);
      res.json({ ...payload, message: 'Costo actualizado' });
    } catch (err) { next(err); }
  },

  async removeManufacturerPrice(req, res, next) {
    try {
      const { id, manufacturerId } = req.params;
      const result = await ProductManufacturerCost.remove(id, manufacturerId);
      if (result === null) {
        return res.status(404).json({ message: 'Ese fabricante no tiene costo registrado para este producto' });
      }
      const payload = await manufacturerPricesPayload(id);
      res.json({ ...payload, message: 'Fabricante quitado del producto' });
    } catch (err) { next(err); }
  },

  /**
   * Modo inverso: dado el precio de contado deseado, devuelve el margen que lo
   * produce. Es como se usa la calculadora en la práctica — se elige un precio
   * comercial bonito y se ajusta el margen hasta aterrizar ahí.
   */
  async marginForPrice(req, res, next) {
    try {
      const baseCost = Number(req.query.baseCost);
      const cashPrice = Number(req.query.cashPrice);
      const config = await PricingConfig.getMap();
      const result = marginFromCashPrice(baseCost, cashPrice, config);
      if (!result) {
        return res.status(400).json({
          message: 'No hay un margen válido para ese costo y precio. Revisa que el precio sea mayor que el costo.',
        });
      }
      const prices = calculatePrices(baseCost, result.marginPercentage, config);
      res.json({ ...result, prices });
    } catch (err) { next(err); }
  },
};

module.exports = productController;
