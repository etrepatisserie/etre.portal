import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, money, fmtDateTime } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'

const PIPELINE = ['Pending', 'Confirmed', 'Packed', 'Shipped']

export default function Dashboard() {
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api.get('/admin/dashboard').then(setD).catch((e) => setError(e.message)) }, [])

  if (error) return <div className="alert error">Cannot reach the API server: {error}. Is <code>npm run dev</code> running?</div>
  if (!d) return <p>Loading…</p>

  const count = (s) => d.pipeline.find((p) => p.status === s)?.count || 0
  const change = d.lastMonth.total ? ((d.thisMonth.total / d.lastMonth.total) - 1) * 100 : null

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        <div className="actions inline">
          <Link to="/admin/customers/new" className="btn secondary">+ Customer</Link>
          <Link to="/admin/sales/new" className="btn primary">+ New Sale</Link>
        </div>
      </div>

      <div className="stats">
        <div className="stat">
          <div className="stat-label">Sales this month</div>
          <div className="stat-value">{money(d.thisMonth.total)}</div>
          <div className="stat-sub">{d.thisMonth.count} orders · last month {money(d.lastMonth.total)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Sales today</div>
          <div className="stat-value">{money(d.today.total)}</div>
          <div className="stat-sub">{d.today.count} orders</div>
        </div>
        <Link to="/admin/sales?status=Open" className="stat link">
          <div className="stat-label">Orders to fulfil</div>
          <div className="stat-value">{d.counts.toFulfil}</div>
          <div className="stat-sub">Pending, confirmed or packed</div>
        </Link>
        <Link to="/admin/stock?status=alert" className="stat link">
          <div className="stat-label">Low / out of stock</div>
          <div className={`stat-value ${d.lowStock.length ? 'warn-text' : ''}`}>{d.lowStock.length}</div>
          <div className="stat-sub">{d.counts.activeHolds} active holds</div>
        </Link>
      </div>
      {change !== null && <p className="muted small trend-note">Month to date is {Math.abs(change).toFixed(0)}% {change >= 0 ? 'above' : 'below'} the whole of last month.</p>}

      <div className="card">
        <div className="card-head"><h2>Fulfilment pipeline</h2><Link to="/admin/sales">All sales →</Link></div>
        <div className="pipeline">
          {PIPELINE.map((s) => (
            <Link key={s} to={`/admin/sales?status=${s}`} className="pipe-step">
              <div className="pipe-count">{count(s)}</div>
              <StatusBadge status={s} />
            </Link>
          ))}
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-head"><h2>Recent orders</h2><Link to="/admin/sales">View all →</Link></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Order #</th><th>Customer</th><th>Placed</th><th>Status</th><th className="num">Total</th></tr></thead>
              <tbody>
                {d.recent.map((o) => (
                  <tr key={o.id}>
                    <td><Link to={`/admin/sales/${o.id}`}>{o.so_number}</Link></td><td>{o.customer_name}</td>
                    <td className="muted">{fmtDateTime(o.order_date)}</td><td><StatusBadge status={o.status} /></td>
                    <td className="num">{money(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="card-head"><h2>Stock alerts</h2><Link to="/admin/stock">Stock tracking →</Link></div>
          {d.lowStock.length === 0 && <p className="muted">All products are above their reorder level.</p>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Product</th><th className="num">Available</th><th className="num">Reorder at</th><th></th></tr></thead>
              <tbody>
                {d.lowStock.map((p) => (
                  <tr key={p.id}>
                    <td>{p.name}<div className="muted small">{p.sku}</div></td>
                    <td className="num">{p.available} {p.uom}</td><td className="num">{p.reorder_level}</td>
                    <td><StatusBadge status={p.stock_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="actions"><Link to="/admin/purchasing/orders/new" className="btn ghost">Create purchase order</Link></div>
        </div>
      </div>

      <div className="stats small">
        <Link to="/admin/customers" className="stat link"><div className="stat-label">Customers</div><div className="stat-value">{d.counts.customers}</div></Link>
        <Link to="/admin/stock/holds" className="stat link"><div className="stat-label">Active stock holds</div><div className="stat-value">{d.counts.activeHolds}</div></Link>
        <Link to="/admin/purchasing/orders" className="stat link"><div className="stat-label">Open purchase orders</div><div className="stat-value">{d.counts.openPOs}</div></Link>
      </div>
    </div>
  )
}
