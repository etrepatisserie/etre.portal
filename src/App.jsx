import { useEffect, useState } from 'react'
import { Routes, Route, Navigate, Outlet, Link, useLocation } from 'react-router-dom'
import { useAuth } from './auth.jsx'
import { api } from './api.js'
import { ADMIN_MENU, FINANCE_MENU, KITCHEN_MENU, CUSTOMER_MENU } from './menus.js'
import AppShell from './components/AppShell.jsx'
import AnnouncementBanner from './components/AnnouncementBanner.jsx'

import Login from './pages/Login.jsx'
import Notifications from './pages/shared/Notifications.jsx'
import ComingSoon from './pages/shared/ComingSoon.jsx'

import AdminDashboard from './pages/admin/Dashboard.jsx'
import SalesOrders from './pages/admin/SalesOrders.jsx'
import SalesOrderView from './pages/admin/SalesOrderView.jsx'
import SalesOrderForm from './pages/admin/SalesOrderForm.jsx'
import Discrepancies from './pages/admin/Discrepancies.jsx'
import Customers from './pages/admin/Customers.jsx'
import CustomerForm from './pages/admin/CustomerForm.jsx'
import StockLevels from './pages/admin/StockLevels.jsx'
import StockAdjust from './pages/admin/StockAdjust.jsx'
import StockHolds from './pages/admin/StockHolds.jsx'
import StockMovements from './pages/admin/StockMovements.jsx'
import Statistics from './pages/admin/Statistics.jsx'
import PurchaseOrderList from './pages/admin/PurchaseOrderList.jsx'
import PurchaseOrderForm from './pages/admin/PurchaseOrderForm.jsx'
import PurchaseOrderView from './pages/admin/PurchaseOrderView.jsx'
import Suppliers from './pages/admin/Suppliers.jsx'
import Products from './pages/admin/Products.jsx'
import ProductImages from './pages/admin/ProductImages.jsx'
import Settings from './pages/admin/Settings.jsx'
import Closures from './pages/admin/Closures.jsx'
import BlockedAccounts from './pages/finance/BlockedAccounts.jsx'
import Collection from './pages/finance/Collection.jsx'
import BukkuLog from './pages/finance/BukkuLog.jsx'
import ProductionCalendar from './pages/kitchen/ProductionCalendar.jsx'
import Announcements from './pages/admin/Announcements.jsx'
import EmailOutbox from './pages/admin/EmailOutbox.jsx'

import FinanceDashboard from './pages/finance/Dashboard.jsx'
import OrdersToInvoice from './pages/finance/OrdersToInvoice.jsx'
import IssueInvoice from './pages/finance/IssueInvoice.jsx'
import Invoices from './pages/finance/Invoices.jsx'
import PaymentVerification from './pages/finance/PaymentVerification.jsx'
import PaymentTerms from './pages/finance/PaymentTerms.jsx'
import AgingReport from './pages/finance/AgingReport.jsx'
import FinanceReports from './pages/finance/Reports.jsx'
import CreditNotes from './pages/finance/CreditNotes.jsx'
import FinanceStatistics from './pages/finance/Statistics.jsx'
import Payables from './pages/finance/Payables.jsx'
import CashCycle from './pages/finance/CashCycle.jsx'
import CompanyTabs from './components/CompanyTabs.jsx'
import { useSelectedOutlet } from './outlet.js'

import KitchenOrders from './pages/kitchen/Orders.jsx'
import KitchenOrderSheet from './pages/kitchen/OrderSheet.jsx'
import ProductionPlan from './pages/kitchen/ProductionPlan.jsx'
import ProductionRecords from './pages/kitchen/ProductionRecords.jsx'
import KitchenReport from './pages/kitchen/Report.jsx'

import Shop from './pages/portal/Shop.jsx'
import MyOrders from './pages/portal/MyOrders.jsx'
import OrderDetail from './pages/portal/OrderDetail.jsx'
import Delivery from './pages/portal/Delivery.jsx'
import Payments from './pages/portal/Payments.jsx'
import Account from './pages/portal/Account.jsx'
import InfoPage from './pages/portal/InfoPage.jsx'
import Icon from './components/Icon.jsx'

export const HOME = { admin: '/admin', finance: '/finance', kitchen: '/kitchen', customer: '/portal' }

// Only lets users of the right role in; everyone else goes to login or their own portal
function RequireRole({ role, children }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="center-screen">Loading…</div>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (user.role !== role) return <Navigate to={HOME[user.role]} replace />
  return children
}

function StaffLayout({ menu, brand, home, theme }) {
  const outlet = useSelectedOutlet()
  const finance = theme === 'finance'
  return (
    <div className={`app ${theme}`}>
      <AppShell menu={menu} portal={brand} home={home} notificationsPath={`${home}/notifications`} hideOutletSwitch={finance}>
        {/* Finance: KL and Ipoh are separate books — the company tabs drive every page; pages reload on switch */}
        {finance && <CompanyTabs />}<Outlet key={finance ? outlet : undefined} />
      </AppShell>
    </div>
  )
}

// The cart lives in the layout so it survives moving between portal pages
function CustomerLayout() {
  const [cart, setCart] = useState({}) // productId -> { product, qty }
  const [announcements, setAnnouncements] = useState([])
  const [attention, setAttention] = useState({})
  useEffect(() => { api.get('/customer/announcements').then(setAnnouncements).catch(() => {}) }, [])
  // red dots: what needs the customer's action now (refreshed every minute and after any change)
  useEffect(() => {
    const load = () => api.get('/customer/attention').then(setAttention).catch(() => {})
    load()
    const t = setInterval(load, 60000)
    window.addEventListener('notifications:refresh', load)
    return () => { clearInterval(t); window.removeEventListener('notifications:refresh', load) }
  }, [])
  const badges = { '/portal/payments': attention.payments, '/portal/delivery': attention.orders, '/portal/orders': attention.orders }
  const count = Object.values(cart).reduce((a, c) => a + c.qty, 0)
  return (
    <div className="app portal">
      <AppShell menu={CUSTOMER_MENU} portal="Customer Portal" home="/portal" notificationsPath="/portal/notifications" badges={badges}
        topExtra={count > 0 && <Link to="/portal" className="cart-chip" title="Items in your order"><Icon name="ShoppingCart" size={16} /> {count}<span className="sr-only"> items in your order</span></Link>}>
        <AnnouncementBanner items={announcements} />
        <Outlet context={{ cart, setCart, announcements }} />
      </AppShell>
    </div>
  )
}

export default function App() {
  const { user, loading } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={loading ? null : <Navigate to={user ? HOME[user.role] : '/login'} replace />} />

      <Route path="/admin" element={<RequireRole role="admin"><StaffLayout menu={ADMIN_MENU} brand="Admin" home="/admin" theme="admin" /></RequireRole>}>
        <Route index element={<AdminDashboard />} />
        <Route path="sales" element={<SalesOrders />} />
        <Route path="sales/new" element={<SalesOrderForm />} />
        <Route path="sales/:id" element={<SalesOrderView />} />
        <Route path="discrepancies" element={<Discrepancies />} />
        <Route path="customers" element={<Customers />} />
        <Route path="customers/new" element={<CustomerForm />} />
        <Route path="stock" element={<StockLevels />} />
        <Route path="stock/adjust" element={<StockAdjust />} />
        <Route path="stock/holds" element={<StockHolds />} />
        <Route path="stock/movements" element={<StockMovements />} />
        <Route path="statistics" element={<Statistics />} />
        <Route path="purchasing/orders" element={<PurchaseOrderList />} />
        <Route path="purchasing/orders/new" element={<PurchaseOrderForm />} />
        <Route path="purchasing/orders/:id" element={<PurchaseOrderView />} />
        <Route path="purchasing/orders/:id/edit" element={<PurchaseOrderForm />} />
        <Route path="purchasing/suppliers" element={<Suppliers />} />
        <Route path="inventory/products" element={<Products />} />
        <Route path="inventory/images" element={<ProductImages />} />
        <Route path="content/announcements" element={<Announcements />} />
        <Route path="content/emails" element={<EmailOutbox />} />
        <Route path="settings" element={<Settings />} />
        <Route path="closures" element={<Closures />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="*" element={<ComingSoon home="/admin" />} />
      </Route>

      <Route path="/finance" element={<RequireRole role="finance"><StaffLayout menu={FINANCE_MENU} brand="Finance" home="/finance" theme="finance" /></RequireRole>}>
        <Route index element={<FinanceDashboard />} />
        <Route path="invoices/new" element={<OrdersToInvoice />} />
        <Route path="invoices/new/:id" element={<IssueInvoice />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="credit-notes" element={<CreditNotes />} />
        <Route path="payments" element={<PaymentVerification />} />
        <Route path="terms" element={<PaymentTerms />} />
        <Route path="blocked" element={<BlockedAccounts />} />
        <Route path="collection" element={<Collection />} />
        <Route path="bukku" element={<BukkuLog />} />
        <Route path="aging" element={<AgingReport />} />
        <Route path="reports" element={<FinanceReports />} />
        <Route path="statistics" element={<FinanceStatistics />} />
        <Route path="payables" element={<Payables />} />
        <Route path="cash-cycle" element={<CashCycle />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="*" element={<ComingSoon home="/finance" />} />
      </Route>

      <Route path="/kitchen" element={<RequireRole role="kitchen"><StaffLayout menu={KITCHEN_MENU} brand="Central Kitchen" home="/kitchen" theme="kitchen" /></RequireRole>}>
        <Route index element={<KitchenOrders />} />
        <Route path="orders" element={<KitchenOrders />} />
        <Route path="orders/:id" element={<KitchenOrderSheet />} />
        <Route path="calendar" element={<ProductionCalendar />} />
        <Route path="production" element={<ProductionPlan />} />
        <Route path="records" element={<ProductionRecords />} />
        <Route path="report" element={<KitchenReport />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="*" element={<ComingSoon home="/kitchen" />} />
      </Route>

      <Route path="/portal" element={<RequireRole role="customer"><CustomerLayout /></RequireRole>}>
        <Route index element={<Shop />} />
        <Route path="orders" element={<MyOrders />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="delivery" element={<Delivery />} />
        <Route path="payments" element={<Payments />} />
        <Route path="account" element={<Account />} />
        <Route path="info/:page" element={<InfoPage />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="*" element={<ComingSoon home="/portal" />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
