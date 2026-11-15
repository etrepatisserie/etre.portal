// Starting data shared by the SQLite seed (seed.js, outlets.js, settings.js) and the MySQL seed
// generator (server/sql/make-seed.js). No database access here.

const SLOTS = (prefix) => JSON.stringify([`${prefix} 9:00 AM – 11:00 AM`, `${prefix} 11:00 AM – 1:00 PM`, `${prefix} 2:00 PM – 5:00 PM`]);

// Outlets = separate companies. Bank account numbers are NOT kept in code: they come from
// server/data/customers.json (git-ignored, "outlets" section) or are typed in Admin › Settings.
export const OUTLET_DEFAULTS = [
  {
    code: 'KL', name: 'Kuala Lumpur',
    company_name: 'ETRE PATISSERIE KL SDN BHD', company_address: '[PLACEHOLDER] KL company address',
    company_reg_no: '202301018733 (1512655-A)', sst_reg_no: '[PLACEHOLDER] SST reg. no.',
    bank_name: 'Maybank', bank_account_name: 'ETRE PATISSERIE KL SDN BHD', bank_account_no: '[PLACEHOLDER] bank account no.',
    pickup_address: '[PLACEHOLDER] KL outlet address', pickup_slots: SLOTS('[PLACEHOLDER]'),
    delivery_slots: JSON.stringify(['[PLACEHOLDER] 8:00 AM – 11:00 AM', '[PLACEHOLDER] 11:00 AM – 2:00 PM']),
    delivery_area: 'Kuala Lumpur / Klang Valley', email: 'kl.etrepatisserie@gmail.com',
  },
  {
    code: 'IPH', name: 'Ipoh',
    company_name: 'ETRE PATISSERIE SDN BHD', company_address: '30-Jalan Lee Kwee Foh, Taman Canning, 31400 Ipoh, Perak',
    company_reg_no: '1375339-U', sst_reg_no: '[PLACEHOLDER] SST reg. no.',
    bank_name: 'RHB Bank', bank_account_name: 'ETRE PATISSERIE SDN BHD', bank_account_no: '[PLACEHOLDER] bank account no.',
    pickup_address: '[PLACEHOLDER] Ipoh outlet address', pickup_slots: SLOTS('[PLACEHOLDER]'),
    delivery_slots: JSON.stringify(['[PLACEHOLDER] 8:00 AM – 11:00 AM', '[PLACEHOLDER] 11:00 AM – 2:00 PM']),
    delivery_area: 'Ipoh & surrounding Perak [PLACEHOLDER]', email: 'etrepatisserie@gmail.com',
  },
];

export const DEFAULT_SETTINGS = {
  sst_rate: 0.06,                      // 6% — applies to products AND delivery fee
  delivery_fee: 25,                    // RM, flat
  free_delivery_threshold: 500,        // RM, product subtotal before SST
  cutoff_time: '13:00',                // MYT
  max_days_ahead: 30,                  // furthest pickup/delivery date a customer can pick
  credit_term_min_months: 2,           // account age before a customer may request 14-day terms
  // company, bank, pickup address/slots and delivery area are per outlet → see OUTLET_DEFAULTS
};

// Initial passwords for the seeded logins (stored hashed in the users table; change them after the first sign-in).
// Used by the SQLite seed, the customer test logins and `npm run sql:seed`.
export const INITIAL_PASSWORDS = { admin: 'admin123', staff: 'staff123', finance: 'finance123', kitchen: 'kitchen123', customer: 'customer123' };

// Staff logins. outlet: KL / IPH, or HQ = head office (sees both). password: key in INITIAL_PASSWORDS.
export const STAFF = [
  { email: 'admin@demo.test', name: 'Alex Admin (head office)', role: 'admin', outlet: 'HQ', password: 'admin' },
  { email: 'staff@demo.test', name: 'Wendy Warehouse (KL)', role: 'admin', outlet: 'KL', password: 'staff' },
  { email: 'admin.ipoh@demo.test', name: 'Ivy Admin (Ipoh)', role: 'admin', outlet: 'IPH', password: 'admin' },
  { email: 'finance@demo.test', name: 'Fiona Finance (head office)', role: 'finance', outlet: 'HQ', password: 'finance' },
  { email: 'kitchen@demo.test', name: 'Ken Kitchen (KL)', role: 'kitchen', outlet: 'KL', password: 'kitchen' },
  { email: 'kitchen.ipoh@demo.test', name: 'Kim Kitchen (Ipoh)', role: 'kitchen', outlet: 'IPH', password: 'kitchen' },
];

// [code, name, contact, email, phone, address]
export const SUPPLIERS = [
  ['SUP-001', 'Dairy Imports Sdn Bhd (demo)', 'John Tan', 'sales@dairy.example', '+60 3-0000 0101', '12 Jalan Industri, Shah Alam'],
  ['SUP-002', 'Baking Supplies Sdn Bhd (demo)', 'Mei Lin', 'orders@bakingsupplies.example', '+60 3-0000 0102', '88 Jalan Gudang, Klang'],
  ['SUP-003', 'PackRight Packaging (demo)', 'Sam Lee', 'hello@packright.example', '+60 3-0000 0103', '5 Jalan Kotak, Puchong'],
];

// [sku, name, category, uom, unit_cost, reorder_level, opening stock (KL; Ipoh gets 60%)]
export const INGREDIENTS = [
  ['ING-BTR', 'Lescure AOP butter 10kg block', 'Ingredients', 'BLK', 480, 5, 20],
  ['ING-CRM', 'Whipping cream 1L', 'Ingredients', 'CTN', 22, 24, 100],
  ['ING-FLR', 'French T45 flour 25kg', 'Ingredients', 'BAG', 120, 6, 30],
  ['ING-SGR', 'Caster sugar 25kg', 'Ingredients', 'BAG', 95, 4, 20],
  ['ING-EGG', 'Eggs, tray of 30', 'Ingredients', 'TRAY', 14, 20, 80],
  ['ING-CHO', 'Dark couverture chocolate 70% 3kg', 'Ingredients', 'BAG', 310, 3, 12],
  ['ING-PIS', 'Pistachio paste 1kg', 'Ingredients', 'TUB', 180, 2, 8],
  ['PKG-BOX', 'Pastry box (4 pc)', 'Packaging', 'EA', 1.2, 200, 1500],
  ['PKG-CAK', 'Cake box 10 inch', 'Packaging', 'EA', 3.5, 50, 300],
];
export const INGREDIENT_OPENING_SCALE = { KL: 1, IPH: 0.6 };
export const UNAVAILABLE_SKUS = ['P-MNG-001']; // seasonal — shows "currently unavailable"

// Fictional customers for trying the system (SEED_DEMO=1 and the tests; seed-demo.sql for MySQL).
// [code, name, contact, email, phone, address, term, account age in days, weight, favourite categories, usual method, outlet code]
export const DEMO_CUSTOMERS = [
  ['CUS-001', 'Sweet Corner Café', 'Grace Wong', 'cafe@demo.test', '+60 3-0000 0201', '21 Jalan Contoh 3, Kuala Lumpur', 'COD', 215, 1, ['VIN', 'PTG', 'BRD'], 'pickup', 'KL'],
  ['CUS-002', 'Maple Street Coffee', 'Tom Lee', 'maple@demo.test', '+60 3-0000 0202', '140 Jalan Sampel, Petaling Jaya', 'NET14', 205, 2, ['VIN', 'SND', 'BRD', 'SDG'], 'delivery', 'KL'],
  ['CUS-003', 'Harbor Hotel Group', 'Priya Nair', 'harbor@demo.test', '+60 3-0000 0203', '1 Lebuh Demo, Loading Bay B, Kuala Lumpur', 'NET14', 210, 3, ['VIN', 'PTG', 'FULLC', 'SDG', 'BRD'], 'delivery', 'KL'],
  ['CUS-004', 'Little Oven Catering', 'Daniel Ruiz', 'littleoven@demo.test', '+60 3-0000 0204', '77 Jalan Ujian, Subang Jaya', 'COD', 190, 1.5, ['SND', 'FULLC', 'PTG', 'BRD'], 'delivery', 'KL'],
  ['CUS-005', 'Bean & Bloom Café', 'Aisha Rahman', 'beanbloom@demo.test', '+60 3-0000 0205', '9 Jalan Baharu, Bangsar', 'COD', 20, 0, ['VIN', 'BRD'], 'pickup', 'KL'],
  ['CUS-006', 'Kinta Kopi House', 'Lim Mei Ling', 'kinta@demo.test', '+60 5-000 0206', '12 Jalan Demo, 30000 Ipoh', 'COD', 160, 1.5, ['VIN', 'BRD', 'SDG'], 'pickup', 'IPH'],
  ['CUS-007', 'Perak Heritage Hotel', 'Raj Kumar', 'perakhotel@demo.test', '+60 5-000 0207', '8 Lebuh Contoh, 30450 Ipoh', 'NET30', 200, 2, ['VIN', 'PTG', 'FULLC', 'BRD'], 'delivery', 'IPH'],
];
