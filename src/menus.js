// Menu definitions for both portals — add ERP modules here as the system grows.
// Items with `soon: true` route to a placeholder page.
export const ADMIN_MENU = [
  { label: 'Dashboard', to: '/admin' },
  {
    label: 'Sales', base: '/admin/sales', also: ['/admin/customers'],
    items: [
      { label: 'Sales Orders', to: '/admin/sales' },
      { label: 'New Sale', to: '/admin/sales/new' },
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
    label: 'Finance', base: '/admin/finance',
    items: [
      { label: 'Invoices', to: '/admin/finance/invoices', soon: true },
      { label: 'Payments', to: '/admin/finance/payments', soon: true },
    ],
  },
]

export const CUSTOMER_MENU = [
  { label: 'Stock Purchase', to: '/portal' },
  { label: 'Purchase History', to: '/portal/orders' },
  { label: 'Delivery Status', to: '/portal/delivery' },
]
