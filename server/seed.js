// Starting data. Runs once, when the database has no users.
// Products come from the real wholesale catalog (server/data/catalog.json).
// REAL customers come from server/data/customers.json (git-ignored) and get NO invented history.
// By default: staff logins, outlets, real customers, the catalog and ingredients with opening stock,
// plus MOCK finance data (orders/invoices/slips numbered MOCK-…) on the few real customers that have a
// test login — see mock-finance.js; SEED_MOCK=0 skips it, `npm run mock:clear` removes it.
// SEED_DEMO=1 (used by the tests) also adds demo customers (marked "(demo)") with 6 months of invented
// orders, invoices, payments and stock so the whole workflow can be tried in both outlets.
// History is simulated with the real timeline rules (cutoff, production day, fulfilment day),
// and a set of current orders covers every status, payment state and payment term.
import db from './db.js';
import { hashPassword } from './passwords.js';
import { round2, fmtMoney } from './errors.js';
import { computeTotals, linesSubtotal } from './pricing.js';
import { addDays, todayMYT, mytDate, processingDay, orderWindow, isWeekend, productionDateFor } from './schedule.js';
import { getSettings } from './settings.js';
import { checkLowStock } from './stock.js';
import { EVENT_TEXT, getOrder } from './sales.js';
import { importCatalog } from './catalog.js';
import { saveBuffer } from './files.js';
import { simplePdf } from './pdf.js';
import { queueEmail } from './email.js';
import { outletByCode, getOutlet } from './outlets.js';
import { termDays, isCredit } from './terms.js';
import { importCustomers } from './customers-import.js';
import { createMock } from './mock-finance.js';
import { INITIAL_PASSWORDS, STAFF, SUPPLIERS, INGREDIENTS, INGREDIENT_OPENING_SCALE, UNAVAILABLE_SKUS, DEMO_CUSTOMERS } from './seed-data.js';

// deterministic random so every fresh seed looks the same
let s = 20261110;
const rand = () => { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const int = (a, b) => a + Math.floor(rand() * (b - a + 1));

const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
const NOW = Date.now();
const TODAY = todayMYT(new Date(NOW));
const sql = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
const past = (ms) => Math.min(ms, NOW - 10 * MIN);
const at = (date, time) => mytDate(date, time).getTime();

export async function seedIfEmpty() {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return;
  if (!process.env.QUIET) console.log(DEMO() ? 'Seeding demo data…' : 'Setting up a clean database (real customers only)…');
  db.transaction(seed)();
}

const DEMO = () => process.env.SEED_DEMO === '1';

function seed() {
  const settings = getSettings();
  const demo = DEMO();

  // ---------- staff ----------
  const KL = outletByCode('KL').id, IPH = outletByCode('IPH').id;
  const outletIdOf = { KL, IPH, HQ: null };
  const addUser = db.prepare('INSERT INTO users (email, password_hash, name, role, customer_id, outlet_id) VALUES (?,?,?,?,?,?)');
  // head office (outlet NULL) sees both outlets; everyone else only their own. Passwords: INITIAL_PASSWORDS in seed-data.js
  const staffIds = {};
  for (const u of STAFF) staffIds[u.email] = addUser.run(u.email, hashPassword(INITIAL_PASSWORDS[u.password]), u.name, u.role, null, outletIdOf[u.outlet]).lastInsertRowid;
  const adminId = staffIds['admin@demo.test'], staffId = staffIds['staff@demo.test'], financeId = staffIds['finance@demo.test'];
  const kitchenId = staffIds['kitchen@demo.test'], kitchenIpohId = staffIds['kitchen.ipoh@demo.test'];
  const kitchenOf = { [KL]: kitchenId, [IPH]: kitchenIpohId };

  // ---------- demo customers (fictional, marked "(demo)") — see seed-data.js ----------
  const customerDefs = DEMO_CUSTOMERS.map((d) => [...d.slice(0, -1), outletIdOf[d[d.length - 1]]]);
  const customers = !demo ? [] : customerDefs.map(([code, rawName, contact, email, phone, address, term, age, weight, taste, method, outlet]) => {
    const start = addDays(TODAY, -age);
    const name = `${rawName} (demo)`;
    const id = db.prepare(`INSERT INTO customers (code,name,outlet_id,contact,email,phone,address,payment_term,is_demo,account_start_date,created_at) VALUES (?,?,?,?,?,?,?,?,1,?,?)`)
      .run(code, name, outlet, contact, email, phone, address, term, start, sql(at(start, '10:00'))).lastInsertRowid;
    const userId = addUser.run(email, hashPassword(INITIAL_PASSWORDS.customer), contact, 'customer', id, null).lastInsertRowid;
    return { id, code, name, email, address, term, userId, weight, taste, method, start, outlet, outletCode: getOutlet(outlet).code };
  });
  const [cafe, maple, harbor, littleoven, bean, kinta, perak] = customers;
  db.prepare("UPDATE customers SET term_updated_at = ?, term_updated_by = ? WHERE payment_term <> 'COD' AND is_demo = 1").run(sql(NOW - 120 * DAY), financeId);

  // ---------- REAL customers from the accounting system (no invented history) ----------
  importCustomers();

  // ---------- suppliers & products ----------
  const addSup = db.prepare('INSERT INTO suppliers (code,name,contact,email,phone,address) VALUES (?,?,?,?,?,?)');
  for (const sup of SUPPLIERS) addSup.run(...sup);

  importCatalog();
  const ingredientDefs = INGREDIENTS;
  const addIng = db.prepare(`INSERT INTO products (sku,name,category,category_code,uom,unit_cost,sell_price,moq,is_sellable,created_at)
                             VALUES (?,?,?,?,?,?,0,1,0,?)`);
  for (const [sku, name, cat, uom, cost] of ingredientDefs) addIng.run(sku, name, cat, cat === 'Packaging' ? 'PKG' : 'ING', uom, cost, sql(NOW - 190 * DAY));
  db.prepare('INSERT OR IGNORE INTO product_stock (product_id, outlet_id) SELECT p.id, o.id FROM products p, outlets o').run();
  for (const [sku, , , , , reorder] of ingredientDefs) db.prepare('UPDATE product_stock SET reorder_level = ? WHERE product_id = (SELECT id FROM products WHERE sku = ?)').run(reorder, sku);
  for (const sku of UNAVAILABLE_SKUS) db.prepare('UPDATE products SET is_available = 0 WHERE sku = ?').run(sku); // seasonal — shows "currently unavailable"

  const reorderOf = Object.fromEntries(ingredientDefs.map((d) => [d[0], d[5]]));
  const products = db.prepare('SELECT * FROM products ORDER BY id').all().map((p) => ({ ...p, on: { [KL]: 0, [IPH]: 0 }, reorder_level: reorderOf[p.sku] || 0 }));
  const sellable = products.filter((p) => p.is_sellable && p.is_available);
  const bySku = Object.fromEntries(products.map((p) => [p.sku, p]));

  if (!demo) { // clean start: opening stock for ingredients only, nothing else invented
    const ingOpen = Object.fromEntries(ingredientDefs.map((d) => [d[0], d[6]]));
    const addMove = db.prepare('INSERT INTO stock_movements (product_id,outlet_id,type,qty,balance_after,reason,ref,user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
    const setOn = db.prepare('UPDATE product_stock SET stock_on_hand = ? WHERE product_id = ? AND outlet_id = ?');
    for (const [outlet, scale] of [[KL, INGREDIENT_OPENING_SCALE.KL], [IPH, INGREDIENT_OPENING_SCALE.IPH]]) {
      for (const p of products.filter((x) => !x.is_sellable)) {
        const q = Math.round(ingOpen[p.sku] * scale);
        addMove.run(p.id, outlet, 'receipt', q, q, 'Opening stock', null, adminId, sql(NOW));
        setOn.run(q, p.id, outlet);
      }
    }
    // MOCK finance data on the real customers' test logins (all numbered MOCK-…; `npm run mock:clear` removes it)
    if (process.env.SEED_MOCK !== '0') createMock({ now: NOW });
    return;
  }

  // ---------- announcements ----------
  let closureDay = addDays(TODAY, 9);
  while (isWeekend(closureDay)) closureDay = addDays(closureDay, 1);
  const addAnn = db.prepare('INSERT INTO announcements (outlet_id, title, body, type, starts_on, ends_on, closure_from, closure_to, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)');
  addAnn.run(null, 'Christmas pre-orders are open [demo]', 'Whole cakes for 24–25 December can be ordered from today. Please order at least 5 working days ahead for large quantities.', 'notice', addDays(TODAY, -4), addDays(TODAY, 25), null, null, adminId, sql(NOW - 4 * DAY));
  addAnn.run(KL, 'KL office closed for staff training [demo]', `No pickups or deliveries on ${closureDay}. Orders placed that day are processed the next working day.`, 'closure', addDays(TODAY, -2), closureDay, closureDay, closureDay, adminId, sql(NOW - 2 * DAY));
  addAnn.run(null, 'Price update from 1 January [demo]', 'Selected viennoiserie prices will change from 1 January. The updated catalog will be shared in December.', 'price_change', addDays(TODAY, -1), addDays(TODAY, 40), null, null, adminId, sql(NOW - DAY));
  const pastClosure = addDays(TODAY, -21);
  addAnn.run(null, 'Public holiday closure [demo]', 'Closed for the public holiday. Normal operations resume the next day.', 'closure', addDays(TODAY, -28), pastClosure, pastClosure, pastClosure, adminId, sql(NOW - 28 * DAY));
  addAnn.run(IPH, 'Ipoh: sourdough bake day is now Saturday [demo]', 'Sourdough loaves for Ipoh customers are baked on Saturdays — order by Thursday 1 PM.', 'notice', addDays(TODAY, -3), addDays(TODAY, 20), null, null, adminId, sql(NOW - 3 * DAY));

  // ---------- order specs ----------
  const orderQty = (p) => (p.uom !== 'PC' ? Math.max(int(1, 3), p.moq) : p.moq === 1 ? int(4, 12) : p.moq * int(1, 4));
  const makeLines = (c, n = int(2, 5)) => [...sellable.filter((p) => c.taste.includes(p.category_code))].sort(() => rand() - 0.5).slice(0, n)
    .map((p) => ({ p, qty: orderQty(p) }));
  const latestWorkingDay = (d) => { while (isWeekend(d)) d = addDays(d, -1); return d; };
  const placedFor = (fulfil, lead = int(0, 3)) => at(latestWorkingDay(addDays(fulfil, -2 - lead)), pick(['08:40', '09:15', '10:05', '11:20', '12:30']));
  const slotFor = (c, method) => { const o = getOutlet(c.outlet); return pick(method === 'pickup' ? o.pickup_slots : o.delivery_slots); };
  const totalWeight = customers.reduce((a, c) => a + c.weight, 0);
  const pickCustomer = () => { let x = rand() * totalWeight; for (const c of customers) { if ((x -= c.weight) < 0) return c; } return harbor; };

  const specs = [];
  // History: ~110 orders with pickup/delivery in the last 6 months → Received (or Cancelled)
  for (let i = 0; i < 110; i++) {
    const c = pickCustomer();
    if (c === bean) continue;
    const fulfil = addDays(TODAY, -Math.round(2 + 175 * Math.pow(rand(), 1.3)));
    if (addDays(fulfil, -3) < c.start) continue;
    const method = rand() < 0.8 ? c.method : (c.method === 'pickup' ? 'delivery' : 'pickup');
    specs.push({ c, fulfil, method, placedAt: placedFor(fulfil), status: rand() < 0.06 ? 'Cancelled' : 'Received', adjust: rand() < 0.07, link: method === 'delivery' && rand() < 0.6 });
  }
  // Current orders: at least one in every status
  const win = (ms, c = harbor) => orderWindow(new Date(ms), { closures: new Set(c.outlet === KL ? [closureDay] : []) });
  const tomorrow = addDays(TODAY, 1);
  const pendingAt = NOW - 2 * HOUR;
  specs.push(
    // new orders — already with the kitchen; Finance still has to invoice them
    { c: harbor, method: 'delivery', placedAt: pendingAt, fulfil: win(pendingAt).dates[1], status: 'Confirmed', invoiced: false, big: true },
    { c: bean, method: 'pickup', placedAt: NOW - 26 * HOUR, fulfil: win(NOW - 26 * HOUR).dates[0], status: 'Confirmed', invoiced: false, codSlip: true, lines: [{ p: bySku['V-BCR-001'], qty: 10 }, { p: bySku['B-OSP-001'], qty: 10 }] },
    { c: harbor, method: 'delivery', placedAt: NOW - 20 * HOUR, fulfil: win(NOW - 20 * HOUR).dates[0], status: 'Confirmed' },
    { c: maple, method: 'delivery', placedAt: NOW - 30 * HOUR, fulfil: win(NOW - 30 * HOUR).dates[0], status: 'Confirmed', printed: true },
    { c: cafe, method: 'pickup', fulfil: tomorrow, placedAt: placedFor(tomorrow, 0), status: 'Processing', cafeSlip: true },
    { c: harbor, method: 'delivery', fulfil: tomorrow, placedAt: placedFor(tomorrow, 1), status: 'Processing' },
    { c: cafe, method: 'pickup', fulfil: TODAY, placedAt: placedFor(TODAY, 0), status: 'Ready for Pickup' },
    { c: maple, method: 'delivery', fulfil: TODAY, placedAt: placedFor(TODAY, 0), status: 'Out for Delivery', link: true },
    { c: harbor, method: 'delivery', fulfil: addDays(TODAY, -1), placedAt: placedFor(addDays(TODAY, -1), 0), status: 'Received', discrepancy: true, link: true },
    { c: littleoven, method: 'delivery', fulfil: addDays(TODAY, -2), placedAt: placedFor(addDays(TODAY, -2), 1), status: 'Received', link: true },
    // Ipoh
    { c: kinta, method: 'pickup', placedAt: NOW - 4 * HOUR, fulfil: win(NOW - 4 * HOUR, kinta).dates[0], status: 'Confirmed', invoiced: false, codSlip: true },
    { c: perak, method: 'delivery', fulfil: tomorrow, placedAt: placedFor(tomorrow, 1), status: 'Processing' },
    { c: perak, method: 'delivery', fulfil: TODAY, placedAt: placedFor(TODAY, 1), status: 'Out for Delivery', link: true },
    { c: kinta, method: 'pickup', fulfil: addDays(TODAY, -1), placedAt: placedFor(addDays(TODAY, -1), 0), status: 'Received' },
    { c: bean, method: 'pickup', placedAt: NOW - 5 * HOUR, fulfil: win(NOW - 5 * HOUR).dates[0], status: 'Cancelled', invoiced: false, lines: [{ p: bySku['V-PAC-001'], qty: 5 }] },
  );
  specs.sort((a, b) => a.placedAt - b.placedAt);

  // ---------- write orders ----------
  const addSO = db.prepare(`INSERT INTO sales_orders (so_number, customer_id, outlet_id, order_date, processing_day, production_date, fulfil_date, method, time_slot,
      delivery_address, area_confirmed, notes, status, subtotal, delivery_fee, sst_rate, sst_amount, total, delivery_provider, delivery_link,
      printed_at, confirmed_at, confirmed_by, received_at, matches_do, cancel_reason, created_by, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const addLine = db.prepare('INSERT INTO sales_order_lines (so_id, product_id, description, original_quantity, quantity, unit_price, line_total) VALUES (?,?,?,?,?,?,?)');
  const addEvent = db.prepare('INSERT INTO delivery_events (so_id, status, note, created_at) VALUES (?,?,?,?)');
  const addAdj = db.prepare(`INSERT INTO order_adjustments (so_id, batch, line_id, product_name, old_qty, new_qty, reason, totals_before, totals_after, user_id, created_at)
                             VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const addNote = db.prepare('INSERT INTO notifications (user_id, type, title, message, link, is_read, created_at) VALUES (?,?,?,?,?,?,?)');
  const usersOfRole = (role, outlet) => db.prepare('SELECT id FROM users WHERE role = ? AND (outlet_id IS NULL OR outlet_id = ?)').all(role, outlet).map((u) => u.id);
  const recent = (ms) => NOW - ms < 7 * DAY;
  const note = (target, type, title, message, link, ms) => {
    if (!recent(ms)) return;
    const ids = target.customer ? [target.customer.userId] : usersOfRole(target.role, target.outlet);
    for (const id of ids) addNote.run(id, type, title, message, link, NOW - ms > 1.5 * DAY ? 1 : 0, sql(ms));
  };
  const emails = []; // sent after everything exists
  const FLOW = ['Confirmed', 'Processing', 'Dispatched', 'Received']; // invoicing runs alongside, see `invoiced`
  const yearSeq = {};
  const invoicesToMake = [];
  const stockEvents = [];

  for (const sp of specs) {
    const c = sp.c;
    const y = new Date(sp.placedAt + 8 * HOUR).getUTCFullYear();
    const seqKey = `${c.outletCode}-${y}`;
    yearSeq[seqKey] = (yearSeq[seqKey] || 0) + 1;
    const soNumber = `SO-${seqKey}-${String(yearSeq[seqKey]).padStart(4, '0')}`;
    let lines = sp.lines || makeLines(c, sp.big ? 6 : undefined);
    if (sp.big) lines = lines.map((l) => ({ ...l, qty: l.p.uom === 'PC' ? Math.max(l.qty, l.p.moq * 6) : Math.max(l.qty, 2) }));
    lines = lines.map((l) => ({ ...l, orig: l.qty }));

    // admin quantity adjustment before the invoice (history examples)
    let adjust = null;
    if (sp.adjust) {
      const target = lines.find((l) => l.qty > l.p.moq) || lines[0];
      const newQty = target.qty > target.p.moq ? target.qty - target.p.moq : 0;
      if (lines.some((l) => l !== target && l.qty > 0) || newQty > 0) {
        adjust = { line: target, newQty, reason: pick(['Short on Lescure butter that day', 'Production capacity reached', 'Item sold out for that date']) };
      }
    }
    const t0 = computeTotals(linesSubtotal(lines.map((l) => ({ quantity: l.orig, unit_price: l.p.sell_price }))), sp.method, settings);
    if (adjust) adjust.line.qty = adjust.newQty;
    const t = computeTotals(linesSubtotal(lines.map((l) => ({ quantity: l.qty, unit_price: l.p.sell_price }))), sp.method, settings);

    const proc = processingDay(new Date(sp.placedAt), { closures: new Set() });
    const production = productionDateFor(sp.fulfil);
    const m = {
      Confirmed: sp.placedAt, // goes straight to the kitchen
      Printed: at(production, '06:00'),
      Processing: at(production, '06:15'),
      Dispatched: at(sp.fulfil, sp.method === 'pickup' ? '09:00' : '08:30'),
      Received: at(sp.fulfil, '14:00'),
      Cancelled: sp.placedAt + 3 * HOUR,
    };
    m.Invoiced = Math.max(sp.placedAt + int(1, 3) * HOUR, at(proc, '11:00')); // Finance invoices during office hours
    for (const k of Object.keys(m)) m[k] = past(m[k]);

    const status = sp.status;
    const invoiced = status !== 'Cancelled' && sp.invoiced !== false;
    const reached = status === 'Cancelled' ? ['Confirmed', 'Cancelled'] : FLOW.slice(0, FLOW.indexOf(status === 'Ready for Pickup' || status === 'Out for Delivery' ? 'Dispatched' : status) + 1);
    const dispatchName = sp.method === 'pickup' ? 'Ready for Pickup' : 'Out for Delivery';
    const has = (k) => reached.includes(k);
    const provider = sp.link && has('Dispatched') ? pick(['Lalamove', 'GoGet']) : null;
    const link = provider ? `https://track.example.com/${provider.toLowerCase()}/DEMO${int(100000, 999999)}` : null;
    const lastAt = m[reached[reached.length - 1]];

    const soId = addSO.run(soNumber, c.id, c.outlet, sql(sp.placedAt), proc, production, sp.fulfil, sp.method, slotFor(c, sp.method),
      sp.method === 'delivery' ? c.address : null, sp.method === 'delivery' ? 1 : 0, sp.note ? null : (rand() < 0.15 ? 'Please call on arrival' : null),
      status, t.subtotal, t.delivery_fee, t.sst_rate, t.sst_amount, t.total, provider, link,
      has('Processing') || sp.printed ? sql(has('Processing') ? m.Printed : past(NOW - 40 * MIN)) : null,
      sql(m.Confirmed), null,
      has('Received') ? sql(m.Received) : null, has('Received') ? (sp.discrepancy ? 0 : 1) : null,
      status === 'Cancelled' ? 'Cancelled by customer' : null, c.userId, sql(lastAt)).lastInsertRowid;

    const lineIds = lines.map((l) => addLine.run(soId, l.p.id, l.p.name, l.orig, l.qty, l.p.sell_price, round2(l.qty * l.p.sell_price)).lastInsertRowid);
    const what = `${sp.method === 'pickup' ? 'Pickup' : 'Delivery'} ${sp.fulfil}`;

    addEvent.run(soId, 'Confirmed', EVENT_TEXT.Confirmed, sql(m.Confirmed));
    note({ customer: c }, 'order_status', `Order ${soNumber} received`, `${what}. It has gone straight to our kitchen.`, `/portal/orders/${soId}`, m.Confirmed);
    note({ role: 'kitchen', outlet: c.outlet }, 'production', `New order ${soNumber}`, `${c.name} · make on ${production} · ${what}`, `/kitchen/orders/${soId}`, m.Confirmed);
    note({ role: 'finance', outlet: c.outlet }, 'to_invoice', `Issue invoice: ${soNumber}`, `${c.name} · ${fmtMoney(t.total)}${c.term === 'COD' ? ' · COD slip attached' : ''}`, `/finance/invoices/new/${soId}`, m.Confirmed);
    note({ role: 'admin', outlet: c.outlet }, 'new_order', `New order ${soNumber}`, `${c.name} · ${fmtMoney(t.total)} · ${what}`, `/admin/sales/${soId}`, m.Confirmed);
    emails.push({ to: c.email, template: 'order_confirmed', soId, at: m.Confirmed });
    if (c.term === 'COD' && (invoiced || sp.codSlip)) addEvent.run(soId, 'Confirmed', 'Payment slip received with the order', sql(m.Confirmed + MIN));
    if (adjust) {
      const adjAt = m.Invoiced - 20 * MIN;
      const li = lines.indexOf(adjust.line);
      addAdj.run(soId, `seed${soId}`, lineIds[li], adjust.line.p.name, adjust.line.orig, adjust.newQty, adjust.reason, JSON.stringify(t0), JSON.stringify(t), staffId, sql(adjAt));
      addEvent.run(soId, 'Confirmed', `Quantities adjusted: ${adjust.line.p.name} ${adjust.line.orig}→${adjust.newQty}`, sql(adjAt));
      emails.push({ to: c.email, template: 'quantity_adjusted', soId, at: adjAt, extra: { changes: [{ product_name: adjust.line.p.name, old_qty: adjust.line.orig, new_qty: adjust.newQty, reason: adjust.reason }], before: t0, after: t } });
    }
    if (invoiced) {
      addEvent.run(soId, 'Invoiced', 'Invoice issued', sql(m.Invoiced));
      invoicesToMake.push({ sp, soId, soNumber, c, t, issuedAt: m.Invoiced, receivedAt: has('Received') ? m.Received : null });
    }
    if (has('Processing')) {
      addEvent.run(soId, 'Processing', EVENT_TEXT.Processing, sql(m.Processing));
      note({ customer: c }, 'order_status', `Order ${soNumber}: Processing`, EVENT_TEXT.Processing, `/portal/orders/${soId}`, m.Processing);
      for (const l of lines.filter((x) => x.qty > 0)) stockEvents.push({ ms: past(at(production, '05:30')), outlet: c.outlet, p: l.p, qty: l.qty, type: 'produce', date: production });
    }
    if (has('Dispatched')) {
      if (link) {
        const linkAt = m.Dispatched - 20 * MIN;
        addEvent.run(soId, 'Processing', `Delivery booked with ${provider} — tracking link added`, sql(linkAt));
        note({ customer: c }, 'delivery_link', `Track order ${soNumber}`, `Delivery booked with ${provider}. Tap to view the tracking link.`, `/portal/orders/${soId}`, linkAt);
        emails.push({ to: c.email, template: 'delivery_link', soId, at: linkAt });
      }
      addEvent.run(soId, dispatchName, dispatchName === 'Ready for Pickup' ? 'Ready for pickup at our outlet' : EVENT_TEXT['Out for Delivery'], sql(m.Dispatched));
      note({ customer: c }, 'order_status', `Order ${soNumber}: ${dispatchName}`, sp.method === 'pickup' ? `Please collect on ${sp.fulfil}.` : 'Your order is on the way.', `/portal/orders/${soId}`, m.Dispatched);
      for (const l of lines.filter((x) => x.qty > 0)) stockEvents.push({ ms: m.Dispatched, outlet: c.outlet, p: l.p, qty: -l.qty, type: 'sale', ref: soNumber, reason: dispatchName });
    }
    if (has('Received')) {
      if (sp.discrepancy) {
        const l = lines.find((x) => x.qty > 1) || lines[0];
        db.prepare("INSERT INTO discrepancies (so_id, line_id, product_name, qty, note, status, created_by, created_at) VALUES (?,?,?,?,?, 'Open', ?, ?)")
          .run(soId, lineIds[lines.indexOf(l)], l.p.name, 2, '2 pieces arrived crushed — box was dented in transit', c.userId, sql(m.Received));
        addEvent.run(soId, 'Received', 'Received — 1 discrepancy report(s)', sql(m.Received));
        note({ role: 'admin', outlet: c.outlet }, 'discrepancy', `Discrepancy reported: ${soNumber}`, `${c.name}: ${l.p.name} (qty 2)`, `/admin/sales/${soId}`, m.Received);
      } else {
        addEvent.run(soId, 'Received', 'Received — items match the Delivery Order', sql(m.Received));
      }
    }
    if (status === 'Cancelled') {
      addEvent.run(soId, 'Cancelled', 'Cancelled by customer', sql(m.Cancelled));
      note({ role: 'admin', outlet: c.outlet }, 'order_status', `Order ${soNumber} cancelled by customer`, c.name, `/admin/sales/${soId}`, m.Cancelled);
    }
  }
  // one older, already-resolved discrepancy
  const oldOrder = db.prepare("SELECT so.id, l.id AS line_id, l.description FROM sales_orders so JOIN sales_order_lines l ON l.so_id = so.id WHERE so.status = 'Received' AND so.customer_id = ? ORDER BY so.id LIMIT 1").get(maple.id);
  if (oldOrder) {
    db.prepare("INSERT INTO discrepancies (so_id, line_id, product_name, qty, note, status, resolution, resolved_by, resolved_at, created_by, created_at) VALUES (?,?,?,?,?, 'Resolved', ?,?,?,?,?)")
      .run(oldOrder.id, oldOrder.line_id, oldOrder.description, 1, 'One piece missing from the box', 'Replacement sent with the next delivery', adminId, sql(NOW - 60 * DAY), maple.userId, sql(NOW - 61 * DAY));
  }

  // ---------- invoices ----------
  invoicesToMake.sort((a, b) => a.issuedAt - b.issuedAt);
  const invYear = {};
  const addInv = db.prepare(`INSERT INTO invoices (inv_number, do_number, so_id, customer_id, outlet_id, issue_date, due_date, subtotal, delivery_fee, sst_rate, sst_amount, total,
      payment_status, source, paid_at, issued_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'Unpaid', 'generated', NULL, ?, ?)`);
  const invoices = invoicesToMake.map((x) => {
    const issue = todayMYT(new Date(x.issuedAt));
    const y = `${x.c.outletCode}-${issue.slice(0, 4)}`; // each outlet company numbers its own invoices
    invYear[y] = (invYear[y] || 0) + 1;
    const n = String(invYear[y]).padStart(4, '0');
    const due = termDays(x.c.term) ? addDays(issue, termDays(x.c.term)) : issue;
    const id = addInv.run(`INV-${y}-${n}`, `DO-${y}-${n}`, x.soId, x.c.id, x.c.outlet, issue, due, x.t.subtotal, x.t.delivery_fee, x.t.sst_rate, x.t.sst_amount, x.t.total, financeId, sql(x.issuedAt)).lastInsertRowid;
    note({ customer: x.c }, 'invoice', `Invoice INV-${y}-${n} issued`, `${fmtMoney(x.t.total)} for ${x.soNumber} · due ${due}`, '/portal/payments', x.issuedAt);
    emails.push({ to: x.c.email, template: 'invoice_issued', soId: x.soId, invoiceId: id, at: x.issuedAt });
    // payment plan: COD customers send the slip with the order (verified after the invoice is issued);
    // credit-term customers pay within the term
    const cod = !isCredit(x.c.term);
    const slipAt = cod ? x.sp.placedAt + 5 * MIN : at(issue, '11:00') + int(5, 12) * DAY;
    const verifyAt = cod ? x.issuedAt + int(1, 4) * HOUR : slipAt + 20 * HOUR;
    return { ...x, id, inv_number: `INV-${y}-${n}`, issue, due, slipAt, verifyAt, outcome: null, soLink: cod ? x.soId : null };
  });

  // demo overrides so each customer shows a different situation
  for (const inv of invoices) {
    if (inv.c === littleoven || inv.c === kinta) inv.verifyAt = Math.min(inv.verifyAt, NOW - HOUR); // all paid → can order
    if (inv.c === perak && inv.due < TODAY) { inv.slipAt = Math.min(inv.slipAt, at(inv.due, '10:00')); inv.verifyAt = Math.min(inv.verifyAt, at(inv.due, '16:00')); }
    if (inv.c === harbor && inv.due < TODAY) { inv.slipAt = Math.min(inv.slipAt, at(inv.due, '10:00')); inv.verifyAt = Math.min(inv.verifyAt, at(inv.due, '16:00')); } // never overdue
    if (inv.c === cafe && !inv.sp.cafeSlip) inv.verifyAt = Math.min(inv.verifyAt, NOW - HOUR);
    if (inv.sp.cafeSlip) inv.verifyAt = Infinity; // slip sent with the order, not yet verified → café is blocked
  }
  const mapleInv = invoices.filter((i) => i.c === maple);
  const overdue = mapleInv.find((i) => i.due < addDays(TODAY, -5) && i.due > addDays(TODAY, -40));
  if (overdue) { overdue.slipAt = Infinity; overdue.verifyAt = Infinity; } // overdue → Maple is blocked (14-day term)
  const mapleLatest = [...mapleInv].reverse().find((i) => i !== overdue && i.issuedAt < NOW - 2 * DAY);
  if (mapleLatest) { mapleLatest.slipAt = NOW - 26 * HOUR; mapleLatest.outcome = 'Rejected'; mapleLatest.verifyAt = NOW - 20 * HOUR; }

  // ---------- payment slips ----------
  const addSlip = db.prepare(`INSERT INTO payment_slips (customer_id, so_id, file_id, reference, amount, status, reject_reason, uploaded_by, reviewed_by, reviewed_at, created_at)
                              VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  const linkSlip = db.prepare('INSERT INTO payment_slip_invoices (slip_id, invoice_id) VALUES (?,?)');
  const setPay = db.prepare('UPDATE invoices SET payment_status = ?, paid_at = ? WHERE id = ?');
  const groups = [];
  const harborPaid = invoices.filter((i) => i.c === harbor && i.verifyAt <= NOW && i.slipAt <= NOW);
  for (let i = 0; i + 1 < harborPaid.length && i < 6; i += 2) groups.push([harborPaid[i], harborPaid[i + 1]]); // one slip covering two invoices
  const grouped = new Set(groups.flat());
  for (const inv of invoices) if (!grouped.has(inv) && inv.slipAt <= NOW) groups.push([inv]);

  for (const g of groups) {
    const last = g[g.length - 1];
    const slipAt = Math.max(...g.map((i) => i.slipAt));
    const verifyAt = Math.max(...g.map((i) => i.verifyAt));
    const amount = round2(g.reduce((a, i) => a + i.t.total, 0));
    const ref = g.map((i) => i.inv_number).join(' ');
    const pdf = simplePdf(['MOCK BANK TRANSFER RECEIPT', 'Maybank2u (demo data - not a real transaction)', `Date: ${sql(slipAt)} UTC`,
      `From: ${last.c.name}`, `To: ${getOutlet(last.c.outlet).bank_account_name}`, `Account: ${getOutlet(last.c.outlet).bank_account_no}`, `Amount: RM ${amount.toFixed(2)}`, `Reference: ${ref}`]);
    const fileId = saveBuffer(pdf, { kind: 'slip', customerId: last.c.id, userId: last.c.userId, name: `slip-${g[0].inv_number}.pdf` });
    const rejected = last.outcome === 'Rejected';
    const done = verifyAt <= NOW;
    const status = !done ? 'Pending' : rejected ? 'Rejected' : 'Verified';
    const reason = rejected ? 'The amount on the slip does not match the invoice total — please check and re-upload.' : null;
    const slipId = addSlip.run(last.c.id, g.length === 1 ? g[0].soLink : null, fileId, ref, amount, status, reason, last.c.userId, done ? financeId : null, done ? sql(verifyAt) : null, sql(slipAt)).lastInsertRowid;
    for (const inv of g) {
      linkSlip.run(slipId, inv.id);
      setPay.run(status === 'Verified' ? 'Paid' : status === 'Rejected' ? 'Rejected' : 'Slip Uploaded', status === 'Verified' ? sql(verifyAt) : null, inv.id);
    }
    note({ role: 'finance', outlet: last.c.outlet }, 'slip', `Payment slip from ${last.c.name}`, `${ref} · ${fmtMoney(amount)}`, '/finance/payments', slipAt);
    if (done) {
      note({ customer: last.c }, 'payment', rejected ? 'Payment slip rejected' : 'Payment verified', rejected ? `${ref}: ${reason}` : `${ref} marked as paid. Thank you!`, '/portal/payments', verifyAt);
      if (recent(verifyAt)) emails.push({ to: last.c.email, template: rejected ? 'payment_rejected' : 'payment_verified', slipId, at: verifyAt });
    }
  }

  for (const sp of specs.filter((x) => x.codSlip)) {
    const o = db.prepare('SELECT id, so_number, total FROM sales_orders WHERE customer_id = ? AND order_date = ?').get(sp.c.id, sql(sp.placedAt));
    const pdf = simplePdf(['MOCK BANK TRANSFER RECEIPT', 'Maybank2u (demo data - not a real transaction)', `Date: ${sql(sp.placedAt)} UTC`,
      `From: ${sp.c.name}`, `To: ${getOutlet(sp.c.outlet).bank_account_name}`, `Account: ${getOutlet(sp.c.outlet).bank_account_no}`, `Amount: RM ${o.total.toFixed(2)}`, `Reference: ${o.so_number}`]);
    const fileId = saveBuffer(pdf, { kind: 'slip', customerId: sp.c.id, userId: sp.c.userId, name: `slip-${o.so_number}.pdf` });
    addSlip.run(sp.c.id, o.id, fileId, o.so_number, o.total, 'Pending', null, sp.c.userId, null, null, sql(sp.placedAt + 4 * MIN));
  }

  // ---------- credit term requests ----------
  const addReq = db.prepare('INSERT INTO credit_term_requests (customer_id, status, note, decided_by, decided_at, decision_note, created_at) VALUES (?,?,?,?,?,?,?)');
  addReq.run(maple.id, 'Approved', 'We order 4–5 times a week and would like to pay fortnightly.', financeId, sql(NOW - 120 * DAY), null, sql(NOW - 123 * DAY));
  addReq.run(littleoven.id, 'Rejected', 'Requesting 14-day terms for our catering contracts.', financeId, sql(NOW - 30 * DAY), 'Please keep a record of on-time payments for 2 more months and apply again.', sql(NOW - 33 * DAY));
  addReq.run(cafe.id, 'Pending', 'Would appreciate a 14-day term — we have ordered with you for over 6 months.', null, null, null, sql(NOW - 3 * DAY));
  note({ role: 'finance', outlet: cafe.outlet }, 'term_request', `Credit term request: ${cafe.name}`, 'Requests a 14-day credit term', '/finance/terms', NOW - 3 * DAY);

  // ---------- stock: production, dispatch, ingredients ----------
  const addMove = db.prepare('INSERT INTO stock_movements (product_id,outlet_id,type,qty,balance_after,reason,ref,user_id,created_at) VALUES (?,?,?,?,?,?,?,?,?)');
  const move = (p, outlet, type, qty, reason, ref, userId, ms) => { p.on[outlet] += qty; addMove.run(p.id, outlet, type, qty, p.on[outlet], reason, ref, userId, sql(ms)); };
  // group production by date+product and add a little surplus for walk-in sales
  const prod = new Map();
  for (const e of stockEvents.filter((x) => x.type === 'produce')) {
    const k = `${e.outlet}|${e.date}|${e.p.id}`;
    const cur = prod.get(k) || { ms: e.ms, p: e.p, qty: 0, date: e.date, outlet: e.outlet };
    cur.qty += e.qty;
    prod.set(k, cur);
  }
  const timeline = [
    ...[...prod.values()].map((x) => ({ ...x, qty: x.qty + (x.p.uom === 'PC' ? int(0, 3) : 0), kind: 'produce' })),
    ...stockEvents.filter((x) => x.type === 'sale').map((x) => ({ ...x, kind: 'sale' })),
  ].sort((a, b) => a.ms - b.ms || (a.kind === 'produce' ? -1 : 1));
  for (const e of timeline) {
    if (e.kind === 'produce') move(e.p, e.outlet, 'receipt', e.qty, 'Production', `PROD-${e.date}`, kitchenOf[e.outlet], e.ms);
    else move(e.p, e.outlet, 'sale', e.qty, e.reason, e.ref, staffId, e.ms);
  }

  const ingredients = products.filter((p) => !p.is_sellable);
  const ingOpening = Object.fromEntries(ingredientDefs.map((d) => [d[0], d[6]]));
  // each outlet's kitchen has its own ingredients (Ipoh is the smaller kitchen)
  let poRestock = 0;
  for (const [outlet, scale] of [[KL, 1], [IPH, 0.6]]) {
    for (const p of ingredients) move(p, outlet, 'receipt', Math.round(ingOpening[p.sku] * scale), 'Opening stock', null, adminId, NOW - 185 * DAY);
    for (let ms = NOW - 170 * DAY; ms < NOW - DAY; ms += 7 * DAY) {
      for (const p of ingredients) {
        const used = Math.max(1, Math.round(ingOpening[p.sku] * scale * (0.08 + rand() * 0.08)));
        if (p.on[outlet] - used < p.reorder_level) {
          poRestock++;
          move(p, outlet, 'receipt', Math.round(ingOpening[p.sku] * scale * 0.8), 'Purchase order received', `PO-HIST-${String(poRestock).padStart(3, '0')}`, staffId, ms - DAY);
        }
        move(p, outlet, 'adjustment', -used, 'Used in production', null, kitchenOf[outlet], ms);
      }
    }
  }
  const butter = bySku['ING-BTR'];
  if (butter.on[KL] > 3) move(butter, KL, 'adjustment', 3 - butter.on[KL], 'Used in production — croissant lamination', null, kitchenId, NOW - 5 * HOUR);
  const setOnHand = db.prepare('UPDATE product_stock SET stock_on_hand = ? WHERE product_id = ? AND outlet_id = ?');
  for (const p of products) for (const outlet of [KL, IPH]) setOnHand.run(p.on[outlet], p.id, outlet);
  db.prepare("INSERT INTO stock_holds (product_id, outlet_id, qty, reason, status, created_by, created_at) VALUES (?, ?, 1, 'Quality check — tub opened in transit', 'Active', ?, ?)")
    .run(bySku['ING-PIS'].id, KL, staffId, sql(NOW - DAY));

  // ---------- purchase orders (ingredients) ----------
  const addPO = db.prepare(`INSERT INTO purchase_orders (po_number,supplier_id,outlet_id,order_date,expected_date,status,notes,tax_rate,subtotal,tax_amount,total,created_at,updated_at)
                            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const addPOLine = db.prepare('INSERT INTO purchase_order_lines (po_id,line_no,product_id,description,quantity,unit_price,line_total) VALUES (?,?,?,?,?,?,?)');
  const year = TODAY.slice(0, 4);
  const poSeq = {};
  [['Received', 2, 30, [['ING-FLR', 20], ['ING-SGR', 10]], KL], ['Approved', 1, 2, [['ING-BTR', 15], ['ING-CRM', 60]], KL],
    ['Submitted', 3, 1, [['PKG-BOX', 1000], ['PKG-CAK', 200]], KL], ['Draft', 2, 0, [['ING-CHO', 6], ['ING-PIS', 4]], KL],
    ['Received', 2, 20, [['ING-FLR', 12], ['ING-EGG', 40]], IPH], ['Draft', 1, 0, [['ING-BTR', 8]], IPH]]
    .forEach(([status, supplierId, daysAgo, lines, outlet]) => {
      const code = getOutlet(outlet).code;
      poSeq[code] = (poSeq[code] || 0) + 1;
      const items = lines.map(([sku, q]) => ({ p: bySku[sku], q, t: round2(q * bySku[sku].unit_cost) }));
      const subtotal = round2(items.reduce((a, x) => a + x.t, 0));
      const date = sql(NOW - daysAgo * DAY);
      const poId = addPO.run(`PO-${code}-${year}-${String(poSeq[code]).padStart(4, '0')}`, supplierId, outlet, date.slice(0, 10), addDays(TODAY, 7 - daysAgo), status, null, 0, subtotal, 0, subtotal, date, date).lastInsertRowid;
      items.forEach((x, n) => addPOLine.run(poId, n + 1, x.p.id, x.p.name, x.q, x.p.unit_cost, x.t));
    });

  // ---------- welcome notes, low stock, emails ----------
  for (const c of customers) {
    db.prepare("INSERT INTO notifications (user_id, type, title, message, link, is_read, created_at) VALUES (?, 'info', 'Welcome to the customer portal', 'Browse our wholesale catalog, place orders, pay invoices and track deliveries here.', '/portal', 1, ?)")
      .run(c.userId, sql(at(c.start, '10:05')));
  }
  for (const p of ingredients) for (const outlet of [KL, IPH]) checkLowStock(p.id, outlet);

  for (const e of emails.filter((x) => recent(x.at)).sort((a, b) => a.at - b.at)) {
    if (e.slipId) {
      const slip = db.prepare('SELECT * FROM payment_slips WHERE id = ?').get(e.slipId);
      const invs = db.prepare('SELECT i.* FROM payment_slip_invoices psi JOIN invoices i ON i.id = psi.invoice_id WHERE psi.slip_id = ?').all(e.slipId);
      const cust = db.prepare('SELECT * FROM customers WHERE id = ?').get(slip.customer_id);
      queueEmail({ to: e.to, template: e.template, data: { customer: cust, slip, invoices: invs }, related: { type: 'payment_slip', id: e.slipId }, at: sql(e.at) });
      continue;
    }
    const order = getOrder(e.soId);
    const data = { order, ...(e.extra || {}) };
    if (e.invoiceId) data.invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(e.invoiceId);
    queueEmail({ to: e.to, template: e.template, data, related: { type: e.invoiceId ? 'invoice' : 'sales_order', id: e.invoiceId || e.soId }, at: sql(e.at) });
  }
}
