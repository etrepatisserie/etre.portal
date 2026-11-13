import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, money, fmtDay, fmtDateTime } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import { Stepper } from '../../components/Timeline.jsx'
import { toneOf } from '../../status.js'
import Icon from '../../components/Icon.jsx'

// Customer "Delivery Status": every order still on its way, with progress, date/slot and the GoGet/Lalamove link
export default function Delivery() {
  const [orders, setOrders] = useState(null)
  const [pickupAddress, setPickupAddress] = useState('')
  useEffect(() => {
    api.get('/customer/orders').then(setOrders)
    api.get('/customer/checkout-info').then((i) => setPickupAddress(i.pickup_address)).catch(() => {})
  }, [])
  if (!orders) return <p>Loading…</p>

  const active = orders.filter((o) => !['Received', 'Cancelled'].includes(o.status)).sort((a, b) => a.fulfil_date.localeCompare(b.fulfil_date))
  const done = orders.filter((o) => o.status === 'Received').slice(0, 10)

  return (
    <div>
      <div className="page-header"><h1>Delivery Status</h1></div>

      <h2 className="section-title">Upcoming ({active.length})</h2>
      {active.length === 0 && <div className="card empty">No open orders. <Link to="/portal">Place a new order</Link>.</div>}
      {active.map((o) => (
        <div key={o.id} className={`card delivery-card tone-${toneOf(o.status)}`}>
          <div className="delivery-head">
            <div>
              <Link to={`/portal/orders/${o.id}`}><strong>{o.so_number}</strong></Link> <StatusBadge status={o.status} />
              <div className="big-date">{o.method === 'pickup' ? 'Pickup' : 'Delivery'} · {fmtDay(o.fulfil_date)} <span className="muted">· {o.time_slot}</span></div>
              <div className="muted small">{o.unit_count} units · {money(o.total)}</div>
            </div>
            <div className="tracking">
              {o.delivery_link
                ? <a className="btn primary small" href={o.delivery_link} target="_blank" rel="noopener noreferrer"><Icon name="MapPin" size={16} /> Track on {o.delivery_provider}</a>
                : o.method === 'pickup'
                  ? <div className="small"><div className="label">Pickup outlet</div>{pickupAddress}</div>
                  : <span className="muted small">Tracking link appears once delivery is booked</span>}
            </div>
          </div>
          <Stepper status={o.status} method={o.method} audience="customer" />
          <div className="muted small">Last update {fmtDateTime(o.updated_at)}</div>
          {['Ready for Pickup', 'Out for Delivery'].includes(o.status) && (
            <Link to={`/portal/orders/${o.id}`} className="btn primary small">Arrived? Check & mark as received →</Link>
          )}
        </div>
      ))}

      <h2 className="section-title">Recently received</h2>
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Order #</th><th>Method</th><th>Date</th><th>Tracking</th><th className="num">Total</th></tr></thead>
            <tbody>
              {done.length === 0 && <tr><td colSpan="5" className="empty"><Icon name="Inbox" size={24} className="empty-icon" />Nothing received yet.</td></tr>}
              {done.map((o) => (
                <tr key={o.id}>
                  <td><Link to={`/portal/orders/${o.id}`}>{o.so_number}</Link></td><td>{o.method === 'pickup' ? 'Pickup' : 'Delivery'}</td>
                  <td>{fmtDay(o.fulfil_date)}</td>
                  <td>{o.delivery_link ? <a href={o.delivery_link} target="_blank" rel="noopener noreferrer">{o.delivery_provider}</a> : '—'}</td>
                  <td className="num">{money(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
