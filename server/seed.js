// Mock data for the prototype. Runs once, when the database has no users.
// Products come from the real wholesale catalog (server/data/catalog.json);
// customers, orders, stock levels and ingredients are invented for the demo.
// Six months of sales history is replayed in date order so that stock balances,
// holds, delivery timelines and notifications are all consistent with each other.
import db from './db.js';
import { hashPassword } from './passwords.js';
import { round2, fmtMoney } from './errors.js';
import { checkLowStock } from './stock.js';
import { notifyUser } from './notify.js';
import { EVENT_TEXT } from './sales.js';
import { importCatalog } from './catalog.js';

// deterministic random so every fresh seed looks the same
let s = 20261110;
const rand = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));

const HOUR = 3600e3, DAY = 24 * HOUR;
const NOW = Date.now();
const sql = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const clampPast = (ms) => Math.min(ms, NOW - 15 * 60e3);

export function seedIfEmpty() {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;
  console.log('Seeding mock data…');
  db.transaction(seed)();
}

function seed() {
  // ---------- Users & customers (fictional) ----------
  const addUser = db.prepare('INSERT INTO users (email, password_hash, name, role, customer_id) VALUES (?,?,?,?,?)');
  const adminId = addUser.run('admin@demo.test', hashPassword('admin123'), 'Alex Admin', 'admin', null).lastInsertRowid;
  const staffId = addUser.run('staff@demo.test', hashPassword('staff123'), 'Wendy Warehouse', 'admin', null).lastInsertRowid;

  const customers = [
    ['CUS-001', 'Sweet Corner Café', 'Grace Wong', 'cafe@demo.test', '+60 3-0000 0201', '21 Jalan Contoh 3, Kuala Lumpur'],
    ['CUS-002', 'Maple Street Coffee', 'Tom Lee', 'maple@demo.test', '+60 3-0000 0202', '140 Jalan Sampel, Petaling Jaya'],
    ['CUS-003', 'Harbor Hotel Group', 'Priya Nair', 'harbor@demo.test', '+60 3-0000 0203', '1 Lebuh Demo, Loading Bay B, Kuala Lumpur'],
    ['CUS-004', 'Little Oven Catering', 'Daniel Ruiz', 'littleoven@demo.test', '+60 3-0000 0204', '77 Jalan Ujian, Subang Jaya'],
  ].map(([code, name, contact, email, phone, address]) => {
    const id = db.prepare('INSERT INTO customers (code,name,contact,email,phone,address,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(code, name, contact, email, phone, address, sql(NOW - 200 * DAY)).lastInsertRowid;
    const userId = addUser.run(email, hashPassword('customer123'), contact, 'customer', id).lastInsertRowid;
    return { id, code, name, address, userId };
  });
  // relative ordering weight: the hotel orders most, the café least
  const customerWeights = [1, 2, 3, 1.5];
  // what each customer tends to buy (category codes)
  const customerTaste = [
    ['VIN', 'PTG', 'BRD'],              // café
    ['VIN', 'SND', 'BRD', 'SDG'],       // coffee shop
    ['VIN', 'PTG', 'FULLC', 'SDG', 'BRD'], // hotel
    ['SND', 'FULLC', 'PTG', 'BRD'],     // catering
  ];

  // ---------- Suppliers (fictional, for ingredients) ----------
  const addSup = db.prepare('INSERT INTO suppliers (code,name,contact,email,phone,address) VALUES (?,?,?,?,?,?)');
  addSup.run('SUP-001', 'Dairy Imports Sdn Bhd (demo)', 'John Tan', 'sales@dairy.example', '+60 3-0000 0101', '12 Jalan Industri, Shah Alam');
  addSup.run('SUP-002', 'Baking Supplies Sdn Bhd (demo)', 'Mei Lin', 'orders@bakingsupplies.example', '+60 3-0000 0102', '88 Jalan Gudang, Klang');
  addSup.run('SUP-003', 'PackRight Packaging (demo)', 'Sam Lee', 'hello@packright.example', '+60 3-0000 0103', '5 Jalan Kotak, Puchong');

  // ---------- Products: catalog (sellable) + ingredients (not sellable) ----------
  importCatalog();
  // [sku, name, category, uom, cost RM, reorder, opening, supplier]
  const ingredientDefs = [
    ['ING-BTR', 'Lescure AOP butter 10kg block', 'Ingredients', 'BLK', 480, 5, 20, 1],
    ['ING-CRM', 'Whipping cream 1L', 'Ingredients', 'CTN', 22, 24, 100, 1],
    ['ING-FLR', 'French T45 flour 25kg', 'Ingredients', 'BAG', 120, 6, 30, 2],
    ['ING-SGR', 'Caster sugar 25kg', 'Ingredients', 'BAG', 95, 4, 20, 2],
    ['ING-EGG', 'Eggs, tray of 30', 'Ingredients', 'TRAY', 14, 20, 80, 2],
    ['ING-CHO', 'Dark couverture chocolate 70% 3kg', 'Ingredients', 'BAG', 310, 3, 12, 2],
    ['ING-PIS', 'Pistachio paste 1kg', 'Ingredients', 'TUB', 180, 2, 8, 2],
    ['PKG-BOX', 'Pastry box (4 pc)', 'Packaging', 'EA', 1.2, 200, 1500, 3],
    ['PKG-CAK', 'Cake box 10 inch', 'Packaging', 'EA', 3.5, 50, 300, 3],
  ];
  const addIng = db.prepare(`INSERT INTO products (sku,name,category,category_code,uom,unit_cost,sell_price,reorder_level,moq,is_sellable,stock_on_hand,created_at)
                             VALUES (?,?,?,?,?,?,0,?,1,0,0,?)`);
  for (const [sku, name, cat, uom, cost, reorder] of ingredientDefs) {
    addIng.run(sku, name, cat, cat === 'Packaging' ? 'PKG' : 'ING', uom, cost, reorder, sql(NOW - 190 * DAY));
  }

  const rows = db.prepare('SELECT * FROM products ORDER BY id').all();
  const ingOpening = Object.fromEntries(ingredientDefs.map((d) => [d[0], d[6]]));
  const products = rows.map((r) => ({
    id: r.id, sku: r.sku, name: r.name, uom: r.uom, cat: r.category_code, moq: r.moq,
    price: r.sell_price, cost: r.unit_cost, reorder: r.reorder_level, sellable: !!r.is_sellable,
    // finished goods: a few days of production; ingredients: from the list above
    opening: r.is_sellable ? (r.uom === 'PC' ? Math.max(r.moq * 30, 60) : 25) : ingOpening[r.sku],
    onHand: 0, held: 0,
  }));
  const sellable = products.filter((p) => p.sellable);
  const ingredients = products.filter((p) => !p.sellable);
  const bySku = Object.fromEntries(products.map((p) => [p.sku, p]));

  const addMove = db.prepare('INSERT INTO stock_movements (product_id,type,qty,balance_after,reason,ref,user_id,created_at) VALUES (?,?,?,?,?,?,?,?)');
  const move = (p, type, qty, reason, ref, userId, at) => {
    p.onHand += qty;
    addMove.run(p.id, type, qty, p.onHand, reason, ref, userId, sql(at));
  };
  for (const p of products) move(p, 'receipt', p.opening, 'Opening stock', null, adminId, NOW - 185 * DAY);

  // ---------- Generate sales orders ----------
  const orders = [];
  for (let i = 0; i < 90; i++) {
    const age = 180 * Math.pow(rand(), 1.25) * DAY; // more orders in recent months (growth)
    orders.push({ at: NOW - age - int(0, 8) * HOUR });
  }
  // guarantee a few fresh orders for the demo workflow
  orders.push({ at: NOW - 3 * HOUR, force: 'Pending' }, { at: NOW - 20 * HOUR, force: 'Pending' },
    { at: NOW - 30 * HOUR, force: 'Confirmed' }, { at: NOW - 2.2 * DAY, force: 'Packed' }, { at: NOW - 3.5 * DAY, force: 'Shipped' });
  orders.sort((a, b) => a.at - b.at);

  const totalWeight = customerWeights.reduce((a, b) => a + b);
  const pickCustomerIdx = () => { let x = rand() * totalWeight; for (const [i, w] of customerWeights.entries()) { if ((x -= w) < 0) return i; } return 0; };

  // quantities always respect the catalog MOQ
  const orderQty = (p) => {
    if (p.uom !== 'PC') return Math.max(int(1, 3), p.moq); // whole cakes / loaves
    if (p.moq === 1) return int(4, 12);                  // sandwiches (no MOQ stated)
    return p.moq * int(1, 4);
  };

  const statusFor = (o) => {
    if (o.force) return o.force;
    const d = (NOW - o.at) / DAY;
    if (d > 14) return rand() < 0.07 ? 'Cancelled' : 'Delivered';
    if (d > 7) return rand() < 0.75 ? 'Delivered' : 'Shipped';
    if (d > 3) return pick(['Delivered', 'Shipped', 'Shipped', 'Packed']);
    if (d > 1.2) return pick(['Packed', 'Confirmed']);
    return pick(['Pending', 'Confirmed']);
  };
  const STEP_OFFSET = { Pending: 0, Confirmed: 3 * HOUR, Packed: 18 * HOUR, Shipped: 1.2 * DAY, Delivered: 1.6 * DAY };
  const FLOW = ['Pending', 'Confirmed', 'Packed', 'Shipped', 'Delivered'];
  const CARRIERS = ['Own delivery van', 'Lalamove', 'GrabExpress'];

  const addSO = db.prepare(`INSERT INTO sales_orders (so_number,customer_id,order_date,status,delivery_address,notes,carrier,tracking_no,total,created_by,updated_at)
                            VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const addLine = db.prepare('INSERT INTO sales_order_lines (so_id,product_id,description,quantity,unit_price,line_total) VALUES (?,?,?,?,?,?)');
  const addEvent = db.prepare('INSERT INTO delivery_events (so_id,status,note,created_at) VALUES (?,?,?,?)');
  const addHold = db.prepare('INSERT INTO stock_holds (product_id,qty,reason,customer_id,so_id,status,created_by,created_at,released_at) VALUES (?,?,?,?,?,?,?,?,?)');
  const addNote = db.prepare('INSERT INTO notifications (user_id,type,title,message,link,is_read,created_at) VALUES (?,?,?,?,?,?,?)');

  // Top up finished goods with a production batch when stock runs low
  let batchNo = 0;
  const ensureStock = (p, qty, at) => {
    if (p.onHand - p.held - qty >= p.reorder) return;
    batchNo++;
    move(p, 'receipt', Math.max(p.opening, qty * 2), 'Production batch', `PB-${String(batchNo).padStart(4, '0')}`, staffId, at - 6 * HOUR);
  };

  const yearCounters = {};
  const pendingSales = []; // stock leaves when shipped, which may be after later orders are placed
  const flushSales = (upTo) => {
    pendingSales.sort((a, b) => a.at - b.at);
    while (pendingSales.length && pendingSales[0].at <= upTo) {
      const x = pendingSales.shift();
      move(x.p, 'sale', -x.qty, 'Shipped to customer', x.ref, staffId, x.at);
      x.p.held -= x.qty;
    }
  };

  for (const o of orders) {
    flushSales(o.at);
    const ci = pickCustomerIdx();
    const c = customers[ci];
    const status = statusFor(o);
    const year = new Date(o.at).getUTCFullYear();
    yearCounters[year] = (yearCounters[year] || 0) + 1;
    const soNumber = `SO-${year}-${String(yearCounters[year]).padStart(4, '0')}`;

    // 2–5 distinct products, mostly from this customer's usual categories
    const pool = sellable.filter((p) => customerTaste[ci].includes(p.cat));
    const chosen = [...pool].sort(() => rand() - 0.5).slice(0, int(2, 5));
    const lines = chosen.map((p) => {
      const qty = orderQty(p);
      ensureStock(p, qty, o.at);
      p.held += qty; // reserved from the moment the order is placed
      return { p, qty, total: round2(qty * p.price) };
    });
    const total = round2(lines.reduce((a, l) => a + l.total, 0));

    const reached = status === 'Cancelled' ? ['Pending', 'Cancelled'] : FLOW.slice(0, FLOW.indexOf(status) + 1);
    const stepTime = (st) => clampPast(st === 'Cancelled' ? o.at + 5 * HOUR : o.at + STEP_OFFSET[st]);
    const shipped = reached.includes('Shipped');
    const carrier = shipped ? pick(CARRIERS) : null;
    const tracking = shipped ? (carrier === 'Own delivery van' ? `DO-${int(100000, 999999)}` : `TRK${int(10000000, 99999999)}`) : null;
    const last = stepTime(reached[reached.length - 1]);

    const soId = addSO.run(soNumber, c.id, sql(o.at), status, c.address, rand() < 0.2 ? 'Please deliver before 8am' : null,
      carrier, tracking, total, c.userId, sql(last)).lastInsertRowid;

    for (const l of lines) {
      addLine.run(soId, l.p.id, l.p.name, l.qty, l.p.price, l.total);
      if (shipped) {
        addHold.run(l.p.id, l.qty, `Reserved for ${soNumber}`, c.id, soId, 'Fulfilled', c.userId, sql(o.at), sql(stepTime('Shipped')));
        pendingSales.push({ p: l.p, qty: l.qty, ref: soNumber, at: stepTime('Shipped') });
      } else if (status === 'Cancelled') {
        addHold.run(l.p.id, l.qty, `Reserved for ${soNumber}`, c.id, soId, 'Released', c.userId, sql(o.at), sql(stepTime('Cancelled')));
        l.p.held -= l.qty;
      } else {
        addHold.run(l.p.id, l.qty, `Reserved for ${soNumber}`, c.id, soId, 'Active', c.userId, sql(o.at), null);
      }
    }

    for (const st of reached) {
      const note = st === 'Shipped' ? `Shipped via ${carrier} · Ref ${tracking}`
        : st === 'Cancelled' ? 'Cancelled at customer request' : EVENT_TEXT[st];
      addEvent.run(soId, st, note, sql(stepTime(st)));
      const isOld = NOW - stepTime(st) > 5 * DAY;
      if (st !== 'Pending' || !isOld) {
        addNote.run(c.userId, 'order_status', `Order ${soNumber}: ${st}`, note, `/portal/orders/${soId}`, isOld ? 1 : 0, sql(stepTime(st)));
      }
    }
    if (NOW - o.at < 7 * DAY) {
      for (const uid of [adminId, staffId]) {
        addNote.run(uid, 'new_order', `New order ${soNumber}`, `${c.name} · ${fmtMoney(total)}`, `/admin/sales/${soId}`,
          status === 'Pending' ? 0 : 1, sql(o.at));
      }
    }
  }
  flushSales(NOW);

  // ---------- Ingredients: used in production every 2 weeks, replenished by purchase orders ----------
  let poRestock = 0;
  for (let t = NOW - 170 * DAY; t < NOW - DAY; t += 14 * DAY) {
    for (const p of ingredients) {
      const used = Math.max(1, Math.round(p.opening * (0.15 + rand() * 0.15)));
      if (p.onHand - used < p.reorder) {
        poRestock++;
        move(p, 'receipt', Math.round(p.opening * 0.8), 'Purchase order received', `PO-HIST-${String(poRestock).padStart(3, '0')}`, staffId, t - DAY);
      }
      move(p, 'adjustment', -used, 'Used in production', null, staffId, t);
    }
  }

  // ---------- Manual holds & adjustments ----------
  const gala = bySku['C-SSC-001'];
  ensureStock(gala, 3, NOW - 5 * DAY);
  addHold.run(gala.id, 3, 'Reserved for Harbor Hotel Christmas gala', customers[2].id, null, 'Active', adminId, sql(NOW - 4 * DAY), null);
  gala.held += 3;
  const quiche = bySku['V-SDQ-001'];
  ensureStock(quiche, 8, NOW - 2 * DAY);
  addHold.run(quiche.id, 8, 'Quality check — batch PB under review', null, null, 'Active', staffId, sql(NOW - 1 * DAY), null);
  quiche.held += 8;

  move(bySku['V-BCR-001'], 'adjustment', -6, 'Damaged in transit (returned)', null, staffId, NOW - 40 * DAY);
  // push a few items into low / out-of-stock so the alerts have something to show
  const setAvailable = (p, target, reason, at) => {
    const delta = target - (p.onHand - p.held);
    if (delta !== 0) move(p, 'adjustment', delta, delta > 0 ? 'Stock count correction' : reason, null, staffId, at);
  };
  setAvailable(bySku['P-MNG-001'], 0, 'Seasonal — mango batch sold out', NOW - 1.5 * DAY);
  setAvailable(bySku['V-BCR-001'], 12, 'End-of-day count', NOW - 0.5 * DAY);
  setAvailable(bySku['ING-BTR'], 3, 'Stock count correction', NOW - 2 * DAY);

  const setOnHand = db.prepare('UPDATE products SET stock_on_hand = ? WHERE id = ?');
  for (const p of products) setOnHand.run(p.onHand, p.id);

  // ---------- Purchase orders (ingredients) ----------
  const addPO = db.prepare(`INSERT INTO purchase_orders (po_number,supplier_id,order_date,expected_date,status,notes,tax_rate,subtotal,tax_amount,total,created_at,updated_at)
                            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
  const addPOLine = db.prepare('INSERT INTO purchase_order_lines (po_id,line_no,product_id,description,quantity,unit_price,line_total) VALUES (?,?,?,?,?,?,?)');
  const year = new Date(NOW).getUTCFullYear();
  [
    ['Received', 2, 30, [['ING-FLR', 20], ['ING-SGR', 10]]],
    ['Approved', 1, 2, [['ING-BTR', 15], ['ING-CRM', 60]]],
    ['Submitted', 3, 1, [['PKG-BOX', 1000], ['PKG-CAK', 200]]],
    ['Draft', 2, 0, [['ING-CHO', 6], ['ING-PIS', 4]]],
  ].forEach(([status, supplierId, daysAgo, lines], i) => {
    const items = lines.map(([sku, q]) => ({ p: bySku[sku], q, t: round2(q * bySku[sku].cost) }));
    const subtotal = round2(items.reduce((a, x) => a + x.t, 0));
    const date = sql(NOW - daysAgo * DAY);
    const poId = addPO.run(`PO-${year}-${String(i + 1).padStart(4, '0')}`, supplierId, date.slice(0, 10),
      sql(NOW + (7 - daysAgo) * DAY).slice(0, 10), status, null, 0, subtotal, 0, subtotal, date, date).lastInsertRowid;
    items.forEach((x, n) => addPOLine.run(poId, n + 1, x.p.id, x.p.name, x.q, x.p.cost, x.t));
  });

  for (const c of customers) {
    notifyUser(c.userId, 'info', 'Welcome to the customer portal', 'Browse our wholesale catalog, place orders and track deliveries here.', '/portal', sql(NOW - 180 * DAY));
    db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ? AND type = 'info'").run(c.userId);
  }
  for (const p of products) checkLowStock(p.id);
}
