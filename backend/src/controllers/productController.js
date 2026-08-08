const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const Product = require('../models/Product');
const ProductManufacturerPrice = require('../models/ProductManufacturerPrice');
const PricingConfig = require('../models/PricingConfig');
const { calculatePrices, profitByCost, marginFromCashPrice } = require('../utils/pricingCalculator');
const { withCalculatedPrices } = require('../utils/productPricing');

/**
 * Arma la respuesta de costos por fabricante de un producto: a cada costo le
 * calcula la utilidad que deja en cada modalidad de pago, contra el precio de
 * venta vigente. El fabricante cuyo costo es el máximo es el que define el
 * precio (base_cost), y se marca con isBaseCost.
 *
 * Los costos marcados como que no afectan el precio quedan fuera de ese máximo.
 */
async function manufacturerPricesPayload(productId) {
  const [[product]] = await pool.execute(
    'SELECT base_cost, margin_percentage, price_cash FROM products WHERE id = ?',
    [productId],
  );
  if (!product) return null;

  const [costs, config] = await Promise.all([
    ProductManufacturerPrice.findByProduct(productId),
    PricingConfig.getMap(),
  ]);

  const baseCost = Number(product.base_cost);
  const prices = calculatePrices(baseCost, product.margin_percentage, config);
  const pricing = costs.filter((c) => c.isActive && c.affectsBaseCost).map((c) => c.cost);
  const maxCost = pricing.length ? Math.max(...pricing) : null;

  return {
    data: costs.map((c) => {
      const profit = profitByCost(c.cost, prices, config);
      return {
        manufacturerId: c.manufacturerId,
        manufacturerName: c.manufacturerName,
        cost: c.cost,
        affectsBaseCost: c.affectsBaseCost,
        isActive: c.isActive,
        isBaseCost: c.isActive && c.affectsBaseCost && c.cost === maxCost,
        utilidadEfectivo: profit?.cash ?? null,
        utilidadTarjeta: profit?.card ?? null,
        utilidadMsi: profit?.msi ?? null,
        utilidadCredito: profit?.credit ?? null,
        marginPct: profit?.marginPct ?? null,
      };
    }),
    baseCost,
    priceCash: prices.price_cash,
    price6msi: prices.price_6msi,
    priceCredit: prices.price_credit,
  };
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
      const data = await withCalculatedPrices(req.body);
      const product = await Product.create(data);
      res.status(201).json({ data: product, message: 'Producto creado exitosamente' });
    } catch (err) { next(err); }
  },

  async update(req, res, next) {
    try {
      // Si cambian costo o margen (o cualquiera de ellos), recalculamos precios.
      // Tomamos el producto actual como fallback para el parámetro no enviado.
      let data = req.body;
      if (req.body.base_cost !== undefined || req.body.margin_percentage !== undefined) {
        const current = await Product.findById(req.params.id, { includeInactive: true });
        data = await withCalculatedPrices(req.body, current || {});
      }
      const product = await Product.update(req.params.id, data);
      if (!product) return res.status(404).json({ message: 'Producto no encontrado' });
      res.json({ data: product, message: 'Producto actualizado' });
    } catch (err) { next(err); }
  },

  async remove(req, res, next) {
    try {
      await Product.delete(req.params.id);
      res.json({ message: 'Producto desactivado exitosamente' });
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

  async getManufacturerPrices(req, res, next) {
    try {
      const payload = await manufacturerPricesPayload(req.params.id);
      if (!payload) return res.status(404).json({ message: 'Producto no encontrado' });
      res.json(payload);
    } catch (err) { next(err); }
  },

  async setManufacturerPrice(req, res, next) {
    try {
      const { id, manufacturerId } = req.params;
      const cost = Number(req.body.cost);
      if (!Number.isFinite(cost) || cost <= 0) {
        return res.status(400).json({ message: 'El costo debe ser un número mayor que cero' });
      }

      const [[product]] = await pool.execute('SELECT id FROM products WHERE id = ?', [id]);
      if (!product) return res.status(404).json({ message: 'Producto no encontrado' });

      const [[manufacturer]] = await pool.execute(
        'SELECT id FROM manufacturers WHERE id = ? AND is_active = TRUE',
        [manufacturerId],
      );
      if (!manufacturer) return res.status(404).json({ message: 'Fabricante no encontrado o inactivo' });

      // Por omisión el costo sí define el precio de venta: es el caso normal.
      const affectsBaseCost = req.body.affectsBaseCost !== false;
      await ProductManufacturerPrice.upsert(id, manufacturerId, cost, affectsBaseCost);
      const payload = await manufacturerPricesPayload(id);
      res.json({ ...payload, message: 'Costo actualizado' });
    } catch (err) { next(err); }
  },

  async removeManufacturerPrice(req, res, next) {
    try {
      const { id, manufacturerId } = req.params;
      const result = await ProductManufacturerPrice.remove(id, manufacturerId);
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
