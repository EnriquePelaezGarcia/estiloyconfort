/**
 * Seed Fase 4: usuarios de negocio (vendedor, repartidor) y pedidos de
 * ejemplo con items, entregas y pagos.
 * Requiere haber ejecutado antes: schema.sql, schema_fase2.sql, seed_fase2.js
 * y schema_fase4.sql.
 * Ejecutar: node src/database/seed_fase4.js
 */
const { pool } = require('../config/database');
const bcrypt = require('bcryptjs');

const PASSWORD = 'Demo1234';

const businessUsers = [
  { email: 'vendedor@estiloyconfort.com', fullName: 'Verónica Vendedora', phone: '2221112233', role: 'seller' },
  { email: 'repartidor@estiloyconfort.com', fullName: 'Ricardo Repartidor', phone: '2224445566', role: 'delivery_person' },
  // Los logins de fabricante no van aquí: pertenecen a un fabricante real de la
  // tabla `manufacturers` y se crean en seed_manufacturer_users.js.
];

async function ensureUsers() {
  const [roles] = await pool.query('SELECT id, name FROM roles');
  const roleMap = Object.fromEntries(roles.map((r) => [r.name, r.id]));
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const ids = {};

  for (const u of businessUsers) {
    await pool.execute(
      `INSERT INTO users (email, password_hash, full_name, phone, role_id)
       VALUES (?,?,?,?,?)
       ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), phone = VALUES(phone)`,
      [u.email, passwordHash, u.fullName, u.phone, roleMap[u.role]],
    );
    const [[row]] = await pool.execute('SELECT id FROM users WHERE email = ?', [u.email]);
    ids[u.role] = row.id;
  }
  return ids;
}

async function generateOrderNumber(offset) {
  const [[{ n }]] = await pool.execute('SELECT COUNT(*) AS n FROM orders');
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `EC-${date}-${String(Number(n) + 1 + offset).padStart(4, '0')}`;
}

async function seed() {
  console.log('🌱 Iniciando seed Fase 4...');
  const ids = await ensureUsers();
  console.log('✅ Usuarios de negocio listos (password: Demo1234)');

  const [[{ orders: existingOrders }]] = await pool.execute('SELECT COUNT(*) AS orders FROM orders');
  if (existingOrders > 0) {
    console.log(`ℹ️  Ya existen ${existingOrders} pedidos. Se omite la creación de pedidos demo.`);
    process.exit(0);
  }

  const [products] = await pool.execute(
    'SELECT id, name, sku, price_cash FROM products WHERE is_active = TRUE LIMIT 6',
  );
  if (products.length === 0) {
    console.log('⚠️  No hay productos. Ejecuta seed_fase2.js primero.');
    process.exit(1);
  }

  const demoOrders = [
    {
      customer: { name: 'Laura Méndez', email: 'laura@example.com', phone: '2223334455' },
      address: 'Av. Juárez 123, Centro, Puebla',
      lat: 19.0414, lng: -98.2063,
      deliveryType: 'with_installation', paymentMethod: 'card', status: 'pending',
      items: [{ p: 0, qty: 1 }, { p: 4, qty: 2 }],
    },
    {
      customer: { name: 'Carlos Ríos', email: 'carlos@example.com', phone: '2226667788' },
      address: 'Calle 5 de Mayo 45, Cholula, Puebla',
      lat: 19.0633, lng: -98.3060,
      deliveryType: 'standard', paymentMethod: 'msi', status: 'fabricating',
      items: [{ p: 2, qty: 1 }],
    },
    {
      customer: { name: 'Sofía Ramírez', phone: '2229990011' },
      address: 'Blvd. Atlixco 200, La Paz, Puebla',
      lat: 19.0350, lng: -98.2200,
      deliveryType: 'standard', paymentMethod: 'cash', status: 'ready',
      items: [{ p: 1, qty: 1 }, { p: 3, qty: 1 }],
    },
  ];

  let offset = 0;
  for (const o of demoOrders) {
    const orderNumber = await generateOrderNumber(offset++);
    const resolved = o.items.map((it) => {
      const prod = products[it.p % products.length];
      const unit = Number(prod.price_cash);
      return { prod, qty: it.qty, unit, subtotal: unit * it.qty };
    });
    const total = resolved.reduce((s, r) => s + r.subtotal, 0);

    const [res] = await pool.execute(
      `INSERT INTO orders
        (order_number, seller_id, customer_name, customer_email, customer_phone,
         delivery_address, delivery_address_lat, delivery_address_lng, delivery_type,
         payment_method, payment_status, payment_amount, order_status, total_amount,
         expected_delivery_date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?, DATE_ADD(CURDATE(), INTERVAL 7 DAY))`,
      [
        orderNumber, ids.seller, o.customer.name, o.customer.email ?? null,
        o.customer.phone ?? null, o.address, o.lat, o.lng, o.deliveryType,
        o.paymentMethod, 'pending', 0, o.status, total,
      ],
    );
    const orderId = res.insertId;

    for (const r of resolved) {
      await pool.execute(
        `INSERT INTO order_items
          (order_id, product_id, product_name, product_sku, quantity, unit_price, subtotal)
         VALUES (?,?,?,?,?,?,?)`,
        [orderId, r.prod.id, r.prod.name, r.prod.sku, r.qty, r.unit, r.subtotal],
      );
    }
    console.log(`  • ${orderNumber} (${o.status}) — ${o.customer.name} — $${total}`);
  }

  // Asigna la primera entrega lista al repartidor demo.
  const [[readyOrder]] = await pool.execute(
    "SELECT id FROM orders WHERE order_status = 'ready' LIMIT 1",
  );
  if (readyOrder) {
    await pool.execute(
      'UPDATE orders SET delivery_person_id = ?, order_status = ? WHERE id = ?',
      [ids.delivery_person, 'in_delivery', readyOrder.id],
    );
    await pool.execute(
      `INSERT INTO deliveries (order_id, delivery_person_id, assignment_date, delivery_status)
       VALUES (?,?, CURDATE(), 'pending')`,
      [readyOrder.id, ids.delivery_person],
    );
    console.log('  • Entrega asignada al repartidor demo para hoy');
  }

  console.log('🎉 Seed Fase 4 completado');
  process.exit(0);
}

seed().catch((err) => { console.error('❌ Error en seed Fase 4:', err.message); process.exit(1); });
