// Every icon in the ERP comes from here: one set (Lucide), one stroke, mapped by meaning.
// Use <Icon name="…" /> (components/Icon.jsx). Icons always sit next to a text label;
// icon-only buttons (close, search, bell, menu) must carry a title and an aria-label.
import {
  AlertCircle, AlertTriangle, ArrowDownToLine, ArrowLeftRight, ArrowRight, ArrowUpFromLine, BadgeCheck, Ban, BarChart3, Bell, Boxes,
  Building2, Calendar, CalendarClock, CalendarDays, Check, ChefHat, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, CircleDashed, CircleDot,
  CircleUser, CircleX, ClipboardList, Clock, Croissant, Download, Factory, FileMinus, FilePlus2, FileSpreadsheet, FileText, Filter, Flame,
  Hand, Hourglass, Image, Inbox, Info, LayoutDashboard, ListOrdered, LogOut, Mail, MapPin, Megaphone, Menu, MessageSquareWarning, Package,
  PackageCheck, PackageX, Pause, Pencil, Play, Plus, Printer, Receipt, RefreshCcw, Refrigerator, RotateCcw, Search, Send, Settings,
  ShoppingBag, ShoppingCart, SlidersHorizontal, Store, Tag, Trash2, TrendingUp, Truck, Upload, UserPlus, Users, Wallet, X,
} from 'lucide-react'

export const ICONS = {
  AlertCircle, AlertTriangle, ArrowDownToLine, ArrowLeftRight, ArrowRight, ArrowUpFromLine, BadgeCheck, Ban, BarChart3, Bell, Boxes,
  Building2, Calendar, CalendarClock, CalendarDays, Check, ChefHat, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, CircleDashed, CircleDot,
  CircleUser, CircleX, ClipboardList, Clock, Croissant, Download, Factory, FileMinus, FilePlus2, FileSpreadsheet, FileText, Filter, Flame,
  Hand, Hourglass, Image, Inbox, Info, LayoutDashboard, ListOrdered, LogOut, Mail, MapPin, Megaphone, Menu, MessageSquareWarning, Package,
  PackageCheck, PackageX, Pause, Pencil, Play, Plus, Printer, Receipt, RefreshCcw, Refrigerator, RotateCcw, Search, Send, Settings,
  ShoppingBag, ShoppingCart, SlidersHorizontal, Store, Tag, Trash2, TrendingUp, Truck, Upload, UserPlus, Users, Wallet, X,
}

// Sizes: tables & badges 16 · sidebar / menu & buttons 18 · dashboard cards 24
export const SIZE = { table: 16, badge: 14, menu: 18, button: 18, card: 24 }

// ---- menus & modules (keyed by the menu item's link, or its group's base path) ----
export const NAV = {
  // admin
  '/admin': 'LayoutDashboard', '/admin/sales': 'Receipt', '/admin/sales?status=all': 'ClipboardList', '/admin/sales/new': 'Plus',
  '/admin/discrepancies': 'MessageSquareWarning', '/admin/customers': 'Users', '/admin/customers/new': 'UserPlus',
  '/admin/stock': 'Boxes', '/admin/stock/adjust': 'SlidersHorizontal', '/admin/stock/holds': 'Pause', '/admin/stock/movements': 'ArrowLeftRight',
  '/admin/inventory/products': 'Croissant', '/admin/inventory/images': 'Image',
  '/admin/purchasing': 'ShoppingBag', '/admin/purchasing/orders': 'ShoppingBag', '/admin/purchasing/orders/new': 'Plus', '/admin/purchasing/suppliers': 'Factory',
  '/admin/statistics': 'BarChart3', '/admin/content': 'Megaphone', '/admin/content/announcements': 'Megaphone', '/admin/content/emails': 'Mail',
  // finance
  '/finance': 'LayoutDashboard', '/finance/invoices': 'FileText', '/finance/invoices/new': 'FilePlus2', '/finance/credit-notes': 'FileMinus',
  '/finance/payments': 'BadgeCheck', '/finance/payables': 'Wallet', '/finance/terms': 'CalendarClock',
  '/finance/reports': 'BarChart3', '/finance/cash-cycle': 'RefreshCcw', '/finance/statistics': 'TrendingUp', '/finance/aging': 'Hourglass',
  // kitchen
  '/kitchen': 'ClipboardList', '/kitchen/production': 'CalendarDays', '/kitchen/records': 'ChefHat', '/kitchen/report': 'BarChart3',
  // customer
  '/portal': 'Store', '/portal/orders': 'ClipboardList', '/portal/delivery': 'Truck', '/portal/payments': 'Wallet', '/portal/account': 'CircleUser',
  '/portal/info': 'Info', '/portal/info/ordering': 'ListOrdered', '/portal/info/prices': 'Tag', '/portal/info/storage': 'Refrigerator', '/portal/info/heating': 'Flame',
  // shared
  '/admin/settings': 'Settings', '/admin/closures': 'CalendarDays', '/finance/blocked': 'Ban', '/finance/collection': 'Hourglass', '/finance/bukku': 'RefreshCcw', '/kitchen/calendar': 'CalendarClock', notifications: 'Bell', settings: 'Settings',
}
export const navIcon = (m) => NAV[m.to] || NAV[m.base] || null

// ---- statuses (badges, progress bar, process legend) ----
export const STATUS_ICON = {
  // orders
  Pending: 'Hourglass', Confirmed: 'Inbox', Invoiced: 'FileText', Released: 'Play', Processing: 'ChefHat',
  'Ready for Pickup': 'PackageCheck', 'Out for Delivery': 'Truck', Received: 'CircleCheck', Cancelled: 'CircleX', Late: 'AlertTriangle',
  // payments & invoices
  Unpaid: 'Clock', 'Slip Uploaded': 'Upload', Paid: 'CircleCheck', Rejected: 'CircleX', Overdue: 'AlertCircle', Verified: 'BadgeCheck',
  // credit notes, complaints, terms
  Requested: 'Clock', Issued: 'CircleCheck', Declined: 'Ban', Open: 'AlertCircle', Resolved: 'CircleCheck',
  COD: 'Wallet', NET14: 'CalendarClock', NET15: 'CalendarClock', NET30: 'CalendarClock', Approved: 'CircleCheck',
  // purchasing, stock, content, email
  Draft: 'CircleDashed', Submitted: 'Send', OK: 'CircleCheck', Low: 'AlertTriangle', Out: 'PackageX', Active: 'Pause', Fulfilled: 'CircleCheck',
  receipt: 'ArrowDownToLine', sale: 'ArrowUpFromLine', adjustment: 'SlidersHorizontal',
  Live: 'CircleDot', Scheduled: 'CalendarClock', Expired: 'Ban', logged: 'Mail', sent: 'CircleCheck', failed: 'CircleX',
}

// ---- notifications (bell list & toasts), by notification type ----
export const NOTIFY_ICON = {
  new_order: 'ShoppingCart', order_status: 'Truck', low_stock: 'AlertTriangle', customer: 'Users', info: 'Info', invoice: 'FileText',
  to_invoice: 'FilePlus2', payment: 'Wallet', slip: 'Upload', term: 'CalendarClock', term_request: 'CalendarClock', production: 'ChefHat',
  delivery_link: 'MapPin', discrepancy: 'MessageSquareWarning', credit_note: 'FileMinus', supplier_bill: 'Wallet',
}

// ---- announcements, by kind ----
export const NOTICE_ICON = { notice: 'Megaphone', closure: 'CalendarDays', price_change: 'Tag' }

// ---- common actions & things ----
export const ACTION = {
  add: 'Plus', edit: 'Pencil', delete: 'Trash2', search: 'Search', filter: 'Filter', close: 'X', download: 'Download', excel: 'FileSpreadsheet',
  print: 'Printer', creditNote: 'FileMinus', replacement: 'RotateCcw', invoice: 'FileText', deliveryOrder: 'Package', slip: 'Upload',
  pickup: 'Store', delivery: 'Truck', date: 'Calendar', outlet: 'Building2', track: 'MapPin', start: 'Play', verify: 'CircleCheck',
  cart: 'ShoppingCart', signOut: 'LogOut', menu: 'Menu', next: 'ArrowRight', you: 'Hand', wait: 'Hourglass', done: 'CircleCheck', reimport: 'RefreshCcw',
}
