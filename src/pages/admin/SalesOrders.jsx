import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, money, fmtDateTime } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'

const FILTERS = ['', 'Open', 'Pending', 'Confirmed', 'Packed', 'Shipped', 'Delivered', 'Cancelled']

export default function SalesOrders() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') || ''
  const [q, setQ] = useState(params.get('q') || '')
  const [orders, setOrders] = useState([])
  const navigate = useNavigate()

  useEffect(() => {
    const p = new URLSearchParams()
    if (status) p.set('status', status)
    if (q) p.set('q', q)
    api.get(`/admin/sales-orders?${p}`).then(setOrders)
  }, [status, q])

  const total = orders.filter((o) => o.status !== 'Cancelled').reduce((a, o) => a + o.total, 0)

  return (
    <div>
      <div className="page-header">
        <h1>Sales Orders</h1>
        <Link to="/admin/sales/new" className="btn primary">+ New Sale</Link>
      </div>
      <div className="card">
        <div className="toolbar">
          <input placeholder="Search order # or customer…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="chips inline">
            {FILTERS.map((f) => (
              <button key={f} className={`chip ${status === f ? 'on' : ''}`} onClick={() => setParams(f ? { status: f } : {})}>
                {f === '' ? 'All' : f === 'Open' ? 'To fulfil' : f}
              </button>
            ))}
          </div>
        </div>
        <div className="muted small table-caption">{orders.length} orders · {money(total)} (excluding cancelled)</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Order #</th><th>Customer</th><th>Placed</th><th className="num">Lines</th><th>Status</th><th>Tracking</th><th className="num">Total</th></tr></thead>
            <tbody>
              {orders.length === 0 && <tr><td colSpan="7" className="empty">No orders match.</td></tr>}
              {orders.map((o) => (
                <tr key={o.id} className="clickable" onClick={() => navigate(`/admin/sales/${o.id}`)}>
                  <td><strong>{o.so_number}</strong></td><td>{o.customer_name}</td><td className="muted">{fmtDateTime(o.order_date)}</td>
                  <td className="num">{o.line_count}</td><td><StatusBadge status={o.status} /></td>
                  <td className="muted small">{o.tracking_no || '—'}</td><td className="num">{money(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
