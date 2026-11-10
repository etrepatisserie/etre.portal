import { useState } from 'react'
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './auth.jsx'
import { ADMIN_MENU, CUSTOMER_MENU } from './menus.js'
import MenuBar from './components/MenuBar.jsx'

import Login from './pages/Login.jsx'
import Notifications from './pages/shared/Notifications.jsx'
import ComingSoon from './pages/shared/ComingSoon.jsx'

import AdminDashboard from './pages/admin/Dashboard.jsx'
import SalesOrders from './pages/admin/SalesOrders.jsx'
import SalesOrderView from './pages/admin/SalesOrderView.jsx'
import SalesOrderForm from './pages/admin/SalesOrderForm.jsx'
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

import Shop from './pages/portal/Shop.jsx'
import MyOrders from './pages/portal/MyOrders.jsx'
import OrderDetail from './pages/portal/OrderDetail.jsx'
import Delivery from './pages/portal/Delivery.jsx'

const homeFor = (user) => (user?.role === 'admin' ? '/admin' : '/portal')

// Only lets users of the right role in; everyone else goes to login or their own portal
function RequireRole({ role, children }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <div className="center-screen">Loading…</div>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (user.role !== role) return <Navigate to={homeFor(user)} replace />
  return children
}

function AdminLayout() {
  return (
    <div className="app">
      <MenuBar menu={ADMIN_MENU} brand="ERP Admin" home="/admin" notificationsPath="/admin/notifications" />
      <main className="content"><Outlet /></main>
    </div>
  )
}

// The cart lives in the layout so it survives moving between portal pages
function CustomerLayout() {
  const [cart, setCart] = useState({}) // productId -> { product, qty }
  const count = Object.values(cart).reduce((a, c) => a + c.qty, 0)
  return (
    <div className="app portal">
      <MenuBar menu={CUSTOMER_MENU} brand="Customer Portal" home="/portal" notificationsPath="/portal/notifications"
        extra={count > 0 && <span className="cart-chip" title="Items in cart">🛒 {count}</span>} />
      <main className="content"><Outlet context={{ cart, setCart }} /></main>
    </div>
  )
}

export default function App() {
  const { user, loading } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/" element={loading ? null : <Navigate to={user ? homeFor(user) : '/login'} replace />} />

      <Route path="/admin" element={<RequireRole role="admin"><AdminLayout /></RequireRole>}>
        <Route index element={<AdminDashboard />} />
        <Route path="sales" element={<SalesOrders />} />
        <Route path="sales/new" element={<SalesOrderForm />} />
        <Route path="sales/:id" element={<SalesOrderView />} />
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
        <Route path="notifications" element={<Notifications />} />
        <Route path="*" element={<ComingSoon home="/admin" />} />
      </Route>

      <Route path="/portal" element={<RequireRole role="customer"><CustomerLayout /></RequireRole>}>
        <Route index element={<Shop />} />
        <Route path="orders" element={<MyOrders />} />
        <Route path="orders/:id" element={<OrderDetail />} />
        <Route path="delivery" element={<Delivery />} />
        <Route path="notifications" element={<Notifications />} />
        <Route path="*" element={<ComingSoon home="/portal" />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
