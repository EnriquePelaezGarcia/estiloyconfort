const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const Product = require('../models/Product');
const ProductManufacturerPrice = require('../models/ProductManufacturerPrice');
const PricingConfig = require('../models/PricingConfig');
const { calculatePrices, marginFromCashPrice, MATERIALS } = require('../utils/pricingCalculator');
const { syncMaterialPricesAndReprice } = require('../utils/productPricing');

/**
 * Arma la respuesta de costos por fabricante de un producto EN LOS TRES
 * MATERIALES (D1/D2/D3). Cada fabricante trae sus tres costos y la utilidad
 * que deja por material × forma de pago (RN-12…RN-15); ProductManufacturerPrice
 * ya resuelve `isBaseCost` por material (RN-02) y deja `null` donde el
 * fabricante no cotiza ese material (RN-03).
 */
async function manufacturerPricesPayload(productId) {
  const [[product]] = await pool.execute(
    'SELECT id, margin_percentage FROM products WHERE id = ?',
    [productId],
  );
  if (!product) return null;

  const [manufacturerCosts, materialRows] = await Promise.all([
    ProductManufacturerPrice.findByProduct(productId),
    pool.execute(
      'SELECT material, base_cost, price_cash, price_6msi, price_credit, price_mayoreo FROM product_material_prices WHERE product_id = ?',
      [productId],
    ).then(([rows]) => rows),
  ]);

  const materials = {};
  for (const material of MATERIALS) {
    const row = materialRows.find((r) => r.material === material);
    materials[material] = row
      ? {
        baseCost: row.base_cost != null ? Number(row.base_cost) : null,
        priceCash: row.price_cash != null ? Number(row.price_cash) : null,
        price6msi: row.price_6msi != null ? Number(row.price_6msi) : null,
        priceCredit: row.price_credit != null ? Number(row.price_credit) : null,
        priceMayoreo: row.price_mayoreo != null ? Number(row.price_mayoreo) : null,
        isQuoted: row.base_cost != null,
      }
      : { baseCost: null, priceCash: null, price6msi: null, priceCredit: null, priceMayoreo: null, isQuoted: false };
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
      // D6: el payload ya NO acepta base_cost/price_cash/price_6msi/price_credit.
      // Son datos derivados; la única captura manual es margin_percentage.
      // eslint-disable-next-line no-unused-vars
      const { base_cost, price_cash, price_6msi, price_credit, ...data } = req.body;
      if (data.margin_percentage !== undefined) {
        const m = Number(data.margin_percentage);
        if (!Number.isFinite(m) || m < 0 || m >= 100) {
          return res.status(400).json({
            message: 'El % de ganancia debe estar entre 0 y 99.99. Un valor >= 100 produce precios negativos.',
          });
        }
      }
      const product = await Product.create(data);
      // Sin costos de fabricante todavía, las 3 filas quedan en NULL: es
      // correcto, el producto "no se cotiza" hasta que se le asigne un costo.
      await syncMaterialPricesAndReprice(product.id);
      res.status(201).json({ data: product, message: 'Producto creado exitosamente' });
    } catch (err) { next(err); }
  },

  async update(req, res, next) {
    try {
      // eslint-disable-next-line no-unused-vars
      const { base_cost, price_cash, price_6msi, price_credit, ...data } = req.body;
      if (data.margin_percentage !== undefined) {
        const m = Number(data.margin_percentage);
        if (!Number.isFinite(m) || m < 0 || m >= 100) {
          return res.status(400).json({
            message: 'El % de ganancia debe estar entre 0 y 99.99. Un valor >= 100 produce precios negativos.',
          });
        }
      }
      const product = await Product.update(req.params.id, data);
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
   * Los 3 materiales de un producto con costo base y los 4 precios finales,
   * SIN el detalle por fabricante (a diferencia de getManufacturerPrices).
   * Pensado para vendedor/POS: necesita el precio, no la composición de costos.
   */
  async getMaterialPrices(req, res, next) {
    try {
      const [rows] = await pool.execute(
        'SELECT material, base_cost, price_cash, price_6msi, price_credit, price_mayoreo FROM product_material_prices WHERE product_id = ?',
        [req.params.id],
      );
      if (!rows.length) return res.status(404).json({ message: 'Producto no encontrado' });
      const data = MATERIALS.map((material) => {
        const row = rows.find((r) => r.material === material);
        const isQuoted = !!row && row.base_cost != null;
        return {
          material,
          estado: isQuoted ? 'cotizado' : 'no_aplica',
          baseCost: isQuoted ? Number(row.base_cost) : null,
          priceCash: isQuoted ? Number(row.price_cash) : null,
          price6msi: isQuoted ? Number(row.price_6msi) : null,
          priceCredit: isQuoted ? Number(row.price_credit) : null,
          priceMayoreo: isQuoted ? Number(row.price_mayoreo) : null,
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

  async setManufacturerPrice(req, res, next) {
    try {
      const { id, manufacturerId } = req.params;
      // Sin compatibilidad hacia atrás (D8): el body viejo { cost } se rechaza.
      const { costs } = req.body;
      if (!costs || typeof costs !== 'object') {
        return res.status(400).json({
          message: 'El body debe traer "costs": { MDF, MELAMINA_BLANCA, MELAMINA_COLOR }, cada uno número o null.',
        });
      }
      const parsedCosts = {};
      let anyCost = false;
      for (const material of MATERIALS) {
        const raw = costs[material];
        if (raw === null || raw === undefined || raw === '') {
          parsedCosts[material] = null;
          continue;
        }
        const value = Number(raw);
        if (!Number.isFinite(value) || value <= 0) {
          return res.status(400).json({
            message: `El costo debe ser mayor a 0. Deja el campo vacío si el fabricante no hace este mueble en ${material}.`,
          });
        }
        parsedCosts[material] = value;
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

      // Por omisión el costo sí define el precio de venta: es el caso normal.
      const affectsBaseCost = req.body.affectsBaseCost !== false;
      await ProductManufacturerPrice.upsert(id, manufacturerId, parsedCosts, affectsBaseCost);
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
