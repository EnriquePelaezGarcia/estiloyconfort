const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const Product = require('../models/Product');
const ProductManufacturerCost = require('../models/ProductManufacturerCost');
const PricingConfig = require('../models/PricingConfig');
const { calculatePrices, marginFromCashPrice } = require('../utils/pricingCalculator');
const { syncMaterialPricesAndReprice } = require('../utils/productPricing');

/**
 * Valida un id de material recibido para etiquetar una imagen (Parte 2 de
 * Docs/plan-imagen-y-ayuda-por-material.md). Devuelve el id numérico si existe
 * en `materials`, o `false` si no. Los casos vacío/null los filtra quien llama.
 */
async function resolveMaterialId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) return false;
  const [[row]] = await pool.execute('SELECT id FROM materials WHERE id = ?', [id]);
  return row ? id : false;
}

/**
 * Arma la respuesta de costos por fabricante de un producto EN LAS CELDAS
 * QUE DECLARA (material M2 × talla D2, o size_id 0 si no usa tallas). Cada
 * fabricante trae su costo por celda y la utilidad que deja;
 * ProductManufacturerCost ya resuelve `isBaseCost` por celda (RN-02) y deja
 * `cost: null` donde nadie ha capturado nada todavía (el hueco de M2).
 *
 * `cells["materialId:sizeId"]` = precio derivado de esa celda.
 * `sizes` = tallas declaradas ([] si el producto no usa el eje de talla).
 * `materials` = materiales declarados, para que el frontend arme las sub-tablas.
 */
async function manufacturerPricesPayload(productId) {
  const [[product]] = await pool.execute(
    'SELECT id, margin_percentage FROM products WHERE id = ?',
    [productId],
  );
  if (!product) return null;

  const [manufacturerCosts, declaredMaterials, declaredSizes] = await Promise.all([
    ProductManufacturerCost.findByProduct(productId),
    Product.getDeclaredMaterials(productId),
    Product.getDeclaredSizes(productId),
  ]);

  const [priceRows] = await pool.execute(
    'SELECT material_id, size_id, base_cost, price_cash, price_6msi, price_credit, price_mayoreo FROM product_material_prices WHERE product_id = ?',
    [productId],
  );

  const activeSizes = declaredSizes.filter((s) => s.isActive);
  const sizeIds = activeSizes.length ? activeSizes.map((s) => s.sizeId) : [0];

  const cells = {};
  const priceByCell = new Map(priceRows.map((r) => [`${r.material_id}:${r.size_id}`, r]));
  for (const m of declaredMaterials.filter((x) => x.isActive)) {
    for (const sizeId of sizeIds) {
      const row = priceByCell.get(`${m.materialId}:${sizeId}`);
      cells[`${m.materialId}:${sizeId}`] = {
        materialId: m.materialId,
        sizeId,
        baseCost: row?.base_cost != null ? Number(row.base_cost) : null,
        priceCash: row?.price_cash != null ? Number(row.price_cash) : null,
        price6msi: row?.price_6msi != null ? Number(row.price_6msi) : null,
        priceCredit: row?.price_credit != null ? Number(row.price_credit) : null,
        priceMayoreo: row?.price_mayoreo != null ? Number(row.price_mayoreo) : null,
        isQuoted: row?.base_cost != null,
      };
    }
  }

  return {
    data: manufacturerCosts,
    cells,
    materials: declaredMaterials
      .filter((m) => m.isActive)
      .map((m) => ({ materialId: m.materialId, code: m.code, label: m.label })),
    sizes: activeSizes.map((s) => ({ sizeId: s.sizeId, code: s.code, label: s.label })),
    marginPercentage: Number(product.margin_percentage),
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
      // MySQL devuelve EXISTS como 0/1; el badge del catálogo espera booleano.
      result.data = result.data.map((p) => ({ ...p, in_stock: Number(p.in_stock) === 1 }));
      res.json(result);
    } catch (err) { next(err); }
  },

  /**
   * GET /api/products/sitemap — lista mínima para el sitemap.xml (lo arma el
   * servidor SSR, Docs/plan-imagen-y-ayuda-por-material.md Parte 3). Solo
   * productos activos y con slug; nada de precios ni imágenes.
   */
  async sitemap(req, res, next) {
    try {
      const [rows] = await pool.execute(
        `SELECT slug, updated_at
           FROM products
          WHERE is_active = TRUE AND slug IS NOT NULL AND slug <> ''
          ORDER BY updated_at DESC`,
      );
      res.json({ data: rows });
    } catch (err) { next(err); }
  },

  async getOne(req, res, next) {
    try {
      // includeInactive: el catálogo público nunca lo manda (un producto
      // desactivado no debe poder verse por su id/slug desde afuera); el
      // admin sí, para poder reabrir su ficha y editarlo aunque esté apagado.
      const includeInactive = req.query.includeInactive === 'true';
      const product = isNaN(req.params.id)
        ? await Product.findBySlug(req.params.id)
        : await Product.findById(req.params.id, { includeInactive });
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
      const { base_cost, price_cash, price_6msi, price_credit, materialIds, sizeIds, material, stock_quantity, ...data } = req.body;
      if (data.margin_percentage !== undefined) {
        const m = Number(data.margin_percentage);
        if (!Number.isFinite(m) || m < 0 || m >= 100) {
          return res.status(400).json({
            message: 'El % de ganancia debe estar entre 0 y 99.99. Un valor >= 100 produce precios negativos.',
          });
        }
      }
      const product = await Product.create(
        data,
        Array.isArray(materialIds) ? materialIds : [],
        Array.isArray(sizeIds) ? sizeIds : [],
      );
      res.status(201).json({ data: product, message: 'Producto creado exitosamente' });
    } catch (err) { next(err); }
  },

  async update(req, res, next) {
    try {
      // eslint-disable-next-line no-unused-vars
      const { base_cost, price_cash, price_6msi, price_credit, materialIds, sizeIds, material, stock_quantity, ...data } = req.body;
      if (data.margin_percentage !== undefined) {
        const m = Number(data.margin_percentage);
        if (!Number.isFinite(m) || m < 0 || m >= 100) {
          return res.status(400).json({
            message: 'El % de ganancia debe estar entre 0 y 99.99. Un valor >= 100 produce precios negativos.',
          });
        }
      }
      const product = await Product.update(
        req.params.id,
        data,
        Array.isArray(materialIds) ? materialIds : null,
        Array.isArray(sizeIds) ? sizeIds : null,
      );
      if (!product) return res.status(404).json({ message: 'Producto no encontrado' });
      if (data.margin_percentage !== undefined) {
        await syncMaterialPricesAndReprice(product.id);
      }
      res.json({ data: product, message: 'Producto actualizado' });
    } catch (err) { next(err); }
  },

  async remove(req, res, next) {
    try {
      // `?permanent=true` borra el producto de la base (para basura de pruebas).
      // Sin el flag se conserva el comportamiento de siempre: solo desactivar.
      const permanent = req.query.permanent === 'true' || req.query.permanent === '1';
      if (!permanent) {
        await Product.delete(req.params.id);
        return res.json({ message: 'Producto desactivado exitosamente' });
      }

      const { deleted, blockedBy, images } = await Product.destroy(req.params.id);
      if (blockedBy.length) {
        return res.status(409).json({
          message: `No se puede eliminar: el producto aparece en ${blockedBy.join(', ')}. Desactívalo en su lugar.`,
          statusCode: 409,
        });
      }
      if (!deleted) return res.status(404).json({ message: 'Producto no encontrado' });

      // Archivos físicos de las imágenes (best-effort), igual que en deleteImage.
      for (const { image_url } of images) {
        try {
          const filename = path.basename(String(image_url).split('?')[0]);
          const filePath = path.join(__dirname, '../../uploads/products', filename);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          const thumbPath = filePath.replace(/\.webp$/i, '-thumb.webp');
          if (thumbPath !== filePath && fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
        } catch (_) {}
      }

      res.json({ message: 'Producto eliminado permanentemente' });
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

  // ===== Tallas del producto (Docs/plan-productos-por-tamano.md — D2) =====

  async getSizes(req, res, next) {
    try {
      const sizes = await Product.getDeclaredSizes(req.params.id);
      res.json({ data: sizes });
    } catch (err) { next(err); }
  },

  /** PUT /api/products/:id/sizes — body: { sizeIds: number[] }. [] = sin talla. */
  async setSizes(req, res, next) {
    try {
      const { sizeIds } = req.body;
      if (!Array.isArray(sizeIds)) {
        return res.status(400).json({ message: 'El body debe traer "sizeIds": number[].' });
      }
      const product = await Product.update(req.params.id, {}, null, sizeIds);
      if (!product) return res.status(404).json({ message: 'Producto no encontrado' });
      const sizes = await Product.getDeclaredSizes(req.params.id);
      res.json({ data: sizes, message: 'Tallas del producto actualizadas' });
    } catch (err) { next(err); }
  },

  // ===== Imágenes =====

  async addImage(req, res, next) {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'Se requiere un archivo de imagen' });
      }

      let materialId = null;
      if (req.body.material_id !== undefined && req.body.material_id !== '' && req.body.material_id !== null) {
        materialId = await resolveMaterialId(req.body.material_id);
        if (materialId === false) {
          return res.status(400).json({ message: 'El material indicado para la imagen no existe.' });
        }
      }

      const [[{ cnt }]] = await pool.execute(
        'SELECT COUNT(*) AS cnt FROM product_images WHERE product_id = ?',
        [req.params.id]
      );

      // RUTA RELATIVA, NO ABSOLUTA. Antes se guardaba
      // `${req.protocol}://${req.get('host')}/uploads/...`, lo que horneaba en
      // la base el host desde el que se subió la foto: una imagen cargada en
      // local quedaba como http://localhost:3000/... y moría al desplegar.
      // Ahora la fila es portable entre ambientes y el frontend le antepone el
      // origen del API que le toque (ver media-url.ts).
      const image_url = `/uploads/products/${req.file.filename}`;

      const image = await Product.addImage(req.params.id, {
        image_url,
        alt_text: req.body.alt_text || '',
        is_primary: cnt === 0,
        order_display: cnt,
        material_id: materialId,
      });

      res.status(201).json({ data: image, message: 'Imagen agregada' });
    } catch (err) { next(err); }
  },

  async deleteImage(req, res, next) {
    try {
      const image = await Product.deleteImage(req.params.id, req.params.imageId);
      if (!image) return res.status(404).json({ message: 'Imagen no encontrada' });

      // Eliminar archivo físico (best-effort). `new URL()` no sirve aquí: las
      // filas nuevas son relativas y las viejas absolutas, así que basta el
      // nombre de archivo del final de la ruta — vale para ambas formas.
      try {
        const filename = path.basename(image.image_url.split('?')[0]);
        const filePath = path.join(__dirname, '../../uploads/products', filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        // La miniatura que genera processProductImage para las tarjetas del catálogo.
        const thumbPath = filePath.replace(/\.webp$/i, '-thumb.webp');
        if (thumbPath !== filePath && fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);
      } catch (_) {}

      res.json({ message: 'Imagen eliminada' });
    } catch (err) { next(err); }
  },

  /**
   * PATCH /products/:id/images/:imageId — actualiza una imagen:
   *   - `is_primary: true`  → la marca como principal (comportamiento original).
   *   - `material_id`       → material que representa (`''`/`null` = genérica).
   *   - `alt_text`          → texto alternativo.
   * Se pueden combinar. (Docs/plan-imagen-y-ayuda-por-material.md, Parte 2.)
   */
  async setPrimaryImage(req, res, next) {
    try {
      const { id, imageId } = req.params;
      let image = null;

      if (req.body.is_primary === true || req.body.is_primary === 'true') {
        image = await Product.setPrimaryImage(id, imageId);
        if (!image) return res.status(404).json({ message: 'Imagen no encontrada' });
      }

      const patch = {};
      if ('material_id' in req.body) {
        if (req.body.material_id === '' || req.body.material_id === null) {
          patch.material_id = null;
        } else {
          const resolved = await resolveMaterialId(req.body.material_id);
          if (resolved === false) {
            return res.status(400).json({ message: 'El material indicado para la imagen no existe.' });
          }
          patch.material_id = resolved;
        }
      }
      if ('alt_text' in req.body) patch.alt_text = req.body.alt_text;

      if (Object.keys(patch).length > 0) {
        image = await Product.setImageMeta(id, imageId, patch);
        if (!image) return res.status(404).json({ message: 'Imagen no encontrada' });
      }

      if (!image) {
        return res.status(400).json({ message: 'Nada que actualizar en la imagen.' });
      }
      res.json({ data: image, message: 'Imagen actualizada' });
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
      const [declared, declaredSizes] = await Promise.all([
        Product.getDeclaredMaterials(req.params.id),
        Product.getDeclaredSizes(req.params.id),
      ]);
      if (!declared.length) return res.status(404).json({ message: 'Producto no encontrado o sin materiales declarados' });

      const [rows] = await pool.execute(
        'SELECT material_id, size_id, base_cost, price_cash, price_6msi, price_credit, price_mayoreo FROM product_material_prices WHERE product_id = ?',
        [req.params.id],
      );
      const byCell = new Map(rows.map((r) => [`${r.material_id}:${r.size_id}`, r]));

      const activeSizes = declaredSizes.filter((s) => s.isActive);
      // Sin tallas declaradas → una celda por material con sizeId 0 / label null.
      const sizeCells = activeSizes.length
        ? activeSizes.map((s) => ({ sizeId: s.sizeId, sizeLabel: s.label }))
        : [{ sizeId: 0, sizeLabel: null }];

      const data = [];
      for (const m of declared.filter((x) => x.isActive)) {
        for (const s of sizeCells) {
          const row = byCell.get(`${m.materialId}:${s.sizeId}`);
          const isQuoted = !!row && row.base_cost != null;
          data.push({
            materialId: m.materialId,
            code: m.code,
            label: m.label,
            sizeId: s.sizeId || null,
            sizeLabel: s.sizeLabel,
            estado: isQuoted ? 'cotizado' : 'no_aplica',
            baseCost: isQuoted ? Number(row.base_cost) : null,
            priceCash: isQuoted ? Number(row.price_cash) : null,
            price6msi: isQuoted && row.price_6msi != null ? Number(row.price_6msi) : null,
            priceCredit: isQuoted && row.price_credit != null ? Number(row.price_credit) : null,
            priceMayoreo: isQuoted && row.price_mayoreo != null ? Number(row.price_mayoreo) : null,
          });
        }
      }
      res.json({ data, sizes: activeSizes.map((s) => ({ sizeId: s.sizeId, code: s.code, label: s.label })) });
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
   * Body: { costs: [{ materialId, sizeId?, cost, affectsBaseCost }] }.
   * `sizeId` opcional: se omite (o 0) para productos sin talla; para productos
   * con talla debe ser una talla declarada (D3).
   */
  async setManufacturerPrice(req, res, next) {
    try {
      const { id, manufacturerId } = req.params;
      const { costs } = req.body;
      if (!Array.isArray(costs) || !costs.length) {
        return res.status(400).json({
          message: 'El body debe traer "costs": [{ materialId, sizeId?, cost, affectsBaseCost }].',
        });
      }

      const [declared, declaredSizes] = await Promise.all([
        Product.getDeclaredMaterials(id),
        Product.getDeclaredSizes(id),
      ]);
      const declaredIds = new Set(declared.map((m) => m.materialId));
      const activeSizeIds = new Set(declaredSizes.filter((s) => s.isActive).map((s) => s.sizeId));
      const productHasSizes = activeSizeIds.size > 0;

      const parsedCosts = [];
      let anyCost = false;
      for (const entry of costs) {
        const materialId = Number(entry?.materialId);
        if (!declaredIds.has(materialId)) {
          return res.status(400).json({
            message: `El material ${entry?.materialId} no está declarado para este producto (Admin → Materiales del producto).`,
          });
        }
        const sizeId = entry?.sizeId != null ? Number(entry.sizeId) : 0;
        if (productHasSizes) {
          if (!activeSizeIds.has(sizeId)) {
            return res.status(400).json({
              message: `La talla ${entry?.sizeId ?? '(sin talla)'} no está declarada para este producto.`,
            });
          }
        } else if (sizeId !== 0) {
          return res.status(400).json({
            message: 'Este producto no usa tallas; no envíes sizeId (o mándalo en 0).',
          });
        }
        const raw = entry.cost;
        if (raw === null || raw === undefined || raw === '') {
          parsedCosts.push({ materialId, sizeId, cost: null, affectsBaseCost: entry.affectsBaseCost !== false });
          continue;
        }
        const value = Number(raw);
        if (!Number.isFinite(value) || value <= 0) {
          return res.status(400).json({
            message: 'El costo debe ser mayor a 0. Deja el campo vacío/null si el fabricante no hace este mueble en esa celda.',
          });
        }
        parsedCosts.push({ materialId, sizeId, cost: value, affectsBaseCost: entry.affectsBaseCost !== false });
        anyCost = true;
      }
      if (!anyCost) {
        return res.status(400).json({ message: 'Se debe capturar al menos un costo en alguna celda.' });
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
