import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, money, fmtDate } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'

// Customer "Purchase History"
export default function MyOrders() {
  const [orders, setOrders] = useState(null)
  const [status, setStatus] = useState('')
  const navigate = useNavigate()
  useEffect(() => { api.get('/customer/orders').then(setOrders) }, [])
  if (!orders) return <p>Loading…</p>

  const live = orders.filter((o) => o.status !== 'Cancelled')
  const spent = live.reduce((a, o) => a + o.total, 0)
  const shown = orders.filter((o) => !status || o.status === status)

  return (
    <div>
      <div className="page-header">
        <h1>Purchase History</h1>
        <Link to="/portal" className="btn primary">+ New order</Link>
      </div>
      <div className="stats">
        <div className="stat"><div className="stat-label">Orders placed</div><div className="stat-value">{live.length}</div></div>
        <div className="stat"><div className="stat-label">Total spent</div><div className="stat-value">{money(spent)}</div></div>
        <div className="stat"><div className="stat-label">In progress</div><div className="stat-value">{orders.filter((o) => ['Pending', 'Confirmed', 'Packed', 'Shipped'].includes(o.status)).length}</div></div>
      </div>
      <div className="card">
        <div className="toolbar">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {['Pending', 'Confirmed', 'Packed', 'Shipped', 'Delivered', 'Cancelled'].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Order #</th><th>Date</th><th className="num">Items</th><th>Status</th><th className="num">Total</th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan="5" className="empty">No orders yet. <Link to="/portal">Start shopping</Link>.</td></tr>}
              {shown.map((o) => (
                <tr key={o.id} className="clickable" onClick={() => navigate(`/portal/orders/${o.id}`)}>
                  <td><strong>{o.so_number}</strong></td><td>{fmtDate(o.order_date)}</td>
                  <td className="num">{o.line_count} lines · {o.unit_count} units</td>
                  <td><StatusBadge status={o.status} /></td><td className="num">{money(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
