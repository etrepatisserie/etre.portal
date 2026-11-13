import { navIcon } from './icons.js'

// Menu definitions for every portal — add ERP modules here as the system grows.
// Items with `soon: true` route to a placeholder page.
export const ADMIN_MENU = [
  { label: 'Dashboard', to: '/admin' },
  {
    label: 'Sales', base: '/admin/sales', also: ['/admin/customers', '/admin/discrepancies'],
    items: [
      { label: 'Open Orders', to: '/admin/sales' },
      { label: 'All Orders', to: '/admin/sales?status=all' },
      { label: 'New Sale', to: '/admin/sales/new' },
      { label: 'Complaints', to: '/admin/discrepancies' },
      { label: 'Customers', to: '/admin/customers' },
      { label: 'Add New Customer', to: '/admin/customers/new' },
    ],
  },
  {
    label: 'Inventory', base: '/admin/stock', also: ['/admin/inventory'],
    items: [
      { label: 'Stock Tracking', to: '/admin/stock' },
      { label: 'Stock Adjustment', to: '/admin/stock/adjust' },
      { label: 'Stock on Hold', to: '/admin/stock/holds' },
      { label: 'Stock Movements', to: '/admin/stock/movements' },
      { label: 'Products', to: '/admin/inventory/products' },
      { label: 'Product Images', to: '/admin/inventory/images' },
    ],
  },
  {
    label: 'Purchasing', base: '/admin/purchasing',
    items: [
      { label: 'Purchase Orders', to: '/admin/purchasing/orders' },
      { label: 'New Purchase Order', to: '/admin/purchasing/orders/new' },
      { label: 'Suppliers', to: '/admin/purchasing/suppliers' },
    ],
  },
  { label: 'Statistics', to: '/admin/statistics' },
  {
    label: 'Content', base: '/admin/content',
    items: [
      { label: 'Announcements', to: '/admin/content/announcements' },
      { label: 'Email Outbox', to: '/admin/content/emails' },
    ],
  },
]

export const FINANCE_MENU = [
  { label: 'Dashboard', to: '/finance' },
  {
    label: 'Invoices', base: '/finance/invoices', also: ['/finance/credit-notes'],
    items: [
      { label: 'Orders to Invoice', to: '/finance/invoices/new' },
      { label: 'All Invoices', to: '/finance/invoices' },
      { label: 'Credit Notes', to: '/finance/credit-notes' },
    ],
  },
  { label: 'Payment Verification', to: '/finance/payments' },
  { label: 'Payables', to: '/finance/payables' },
  { label: 'Payment Terms', to: '/finance/terms' },
  {
    label: 'Reports', base: '/finance/reports', also: ['/finance/aging', '/finance/statistics', '/finance/cash-cycle'],
    items: [
      { label: 'Cash Conversion Cycle', to: '/finance/cash-cycle' },
      { label: 'Statistics (graphs)', to: '/finance/statistics' },
      { label: 'Monthly Report (sales, SST, collections)', to: '/finance/reports' },
      { label: 'Aging Report', to: '/finance/aging' },
    ],
  },
]

export const KITCHEN_MENU = [
  { label: 'Orders', to: '/kitchen' },
  { label: 'Production Plan', to: '/kitchen/production' },
  { label: 'Production Records', to: '/kitchen/records' },
  { label: 'Summary Report', to: '/kitchen/report' },
]

export const CUSTOMER_MENU = [
  { label: 'Stock Purchase', to: '/portal' },
  { label: 'Purchase History', to: '/portal/orders' },
  { label: 'Delivery Status', to: '/portal/delivery' },
  { label: 'Payments', to: '/portal/payments' },
  {
    label: 'Info', base: '/portal/info',
    items: [
      { label: 'Ordering Process & Timeline', to: '/portal/info/ordering' },
      { label: 'Suggested Selling Prices', to: '/portal/info/prices' },
      { label: 'Storage Guide', to: '/portal/info/storage' },
      { label: 'Heating Guidelines', to: '/portal/info/heating' },
    ],
  },
  { label: 'Account', to: '/portal/account' },
]

// Every page in a menu as one flat list (search palette, breadcrumbs)
export const flattenMenu = (menu) => menu.flatMap((m) => (m.items
  ? m.items.map((it) => ({ ...it, group: m.label, icon: navIcon(it) || navIcon(m) }))
  : [{ ...m, group: '', icon: navIcon(m) }]))

// Breadcrumb trail for a path: [group, page] from the menu, or the closest parent page for detail pages
export function trailFor(menu, pathname, search = '') {
  const flat = flattenMenu(menu)
  const exact = flat.find((x) => x.to === pathname + search) || flat.find((x) => x.to === pathname)
  if (exact) return { group: exact.group, page: exact.label, detail: null }
  const parent = flat.filter((x) => !x.to.includes('?') && pathname.startsWith(`${x.to}/`)).sort((a, b) => b.to.length - a.to.length)[0]
  if (parent) return { group: parent.group, page: parent.label, to: parent.to, detail: 'Details' }
  if (pathname.endsWith('/notifications')) return { group: '', page: 'Notifications', detail: null }
  return { group: '', page: '', detail: null }
}
