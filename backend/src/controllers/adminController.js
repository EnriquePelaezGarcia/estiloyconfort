const { pool } = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');

/**
 * GET /api/admin/dashboard  (solo admin)
 * Estadísticas agregadas con datos reales de las tablas existentes
 * (usuarios, productos, categorías). Los módulos de ventas/finanzas
 * llegan en la Fase 4 cuando existan las tablas orders/payments.
 */
const getDashboard = asyncHandler(async (req, res) => {
  const [[userStats]] = await pool.query(
    `SELECT
        COUNT(*) AS totalUsers,
        SUM(is_active = TRUE) AS activeUsers,
        SUM(is_active = FALSE) AS inactiveUsers
     FROM users`,
  );

  const [usersByRole] = await pool.query(
    `SELECT r.name AS role, COUNT(u.id) AS count
     FROM roles r
     LEFT JOIN users u ON u.role_id = r.id
     GROUP BY r.id, r.name
     ORDER BY r.id`,
  );

  const [[productStats]] = await pool.query(
    `SELECT
        COUNT(*) AS totalProducts,
        SUM(stock_quantity <= stock_alert_level) AS lowStockCount,
        SUM(stock_quantity = 0) AS outOfStockCount,
        COALESCE(SUM(base_cost * stock_quantity), 0) AS inventoryValue
     FROM products
     WHERE is_active = TRUE`,
  );

  const [[{ totalCategories }]] = await pool.query(
    'SELECT COUNT(*) AS totalCategories FROM categories',
  );

  const [recentProducts] = await pool.query(
    `SELECT p.id, p.name, p.sku, p.price_cash, p.stock_quantity, p.stock_alert_level,
            c.name AS category_name, p.created_at
     FROM products p
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE p.is_active = TRUE
     ORDER BY p.created_at DESC
     LIMIT 5`,
  );

  const [lowStockProducts] = await pool.query(
    `SELECT id, name, sku, stock_quantity, stock_alert_level
     FROM products
     WHERE is_active = TRUE AND stock_quantity <= stock_alert_level
     ORDER BY stock_quantity ASC
     LIMIT 5`,
  );

  res.json({
    users: {
      total: Number(userStats.totalUsers) || 0,
      active: Number(userStats.activeUsers) || 0,
      inactive: Number(userStats.inactiveUsers) || 0,
      byRole: usersByRole.map((r) => ({ role: r.role, count: Number(r.count) })),
    },
    products: {
      total: Number(productStats.totalProducts) || 0,
      lowStock: Number(productStats.lowStockCount) || 0,
      outOfStock: Number(productStats.outOfStockCount) || 0,
      inventoryValue: Number(productStats.inventoryValue) || 0,
    },
    categories: Number(totalCategories) || 0,
    recentProducts,
    lowStockProducts,
  });
});

module.exports = { getDashboard };
