import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, money, fmtDate, fmtDateTime } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import { Stepper } from '../../components/Timeline.jsx'

// Customer "Delivery Status": every order that's still on its way, with progress and tracking
export default function Delivery() {
  const [orders, setOrders] = useState(null)
  useEffect(() => { api.get('/customer/orders').then(setOrders) }, [])
  if (!orders) return <p>Loading…</p>

  const active = orders.filter((o) => ['Pending', 'Confirmed', 'Packed', 'Shipped'].includes(o.status))
  const monthAgo = Date.now() - 30 * 864e5
  const delivered = orders.filter((o) => o.status === 'Delivered' && new Date(o.updated_at.replace(' ', 'T') + 'Z') > monthAgo)

  return (
    <div>
      <div className="page-header"><h1>Delivery Status</h1></div>

      <h2 className="section-title">On the way ({active.length})</h2>
      {active.length === 0 && <div className="card empty">No open deliveries. <Link to="/portal">Place a new order</Link>.</div>}
      {active.map((o) => (
        <div key={o.id} className="card delivery-card">
          <div className="delivery-head">
            <div>
              <Link to={`/portal/orders/${o.id}`}><strong>{o.so_number}</strong></Link> <StatusBadge status={o.status} />
              <div className="muted small">Ordered {fmtDate(o.order_date)} · {o.unit_count} units · {money(o.total)}</div>
            </div>
            <div className="tracking">
              {o.tracking_no
                ? <><div className="label">{o.carrier}</div><code>{o.tracking_no}</code></>
                : <span className="muted small">Tracking number available once shipped</span>}
            </div>
          </div>
          <Stepper status={o.status} />
          <div className="muted small">Last update {fmtDateTime(o.updated_at)}</div>
        </div>
      ))}

      <h2 className="section-title">Delivered in the last 30 days ({delivered.length})</h2>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Order #</th><th>Delivered</th><th>Carrier</th><th>Tracking</th><th className="num">Total</th></tr></thead>
            <tbody>
              {delivered.length === 0 && <tr><td colSpan="5" className="empty">Nothing delivered recently.</td></tr>}
              {delivered.map((o) => (
                <tr key={o.id}>
                  <td><Link to={`/portal/orders/${o.id}`}>{o.so_number}</Link></td><td>{fmtDateTime(o.updated_at)}</td>
                  <td>{o.carrier}</td><td><code>{o.tracking_no}</code></td><td className="num">{money(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
