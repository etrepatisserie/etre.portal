import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, money, fmtDate, fmtDay } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import { toneOf } from '../../status.js'
import Icon from '../../components/Icon.jsx'

// Customer "Purchase History": one invoice summary with a single pay button, things to receive, then all orders
export default function MyOrders() {
  const [orders, setOrders] = useState(null)
  const [invoices, setInvoices] = useState([])
  const [status, setStatus] = useState('')
  const navigate = useNavigate()
  useEffect(() => {
    api.get('/customer/orders').then(setOrders)
    api.get('/customer/invoices').then(setInvoices)
  }, [])
  if (!orders) return <p>Loading…</p>

  const toPay = invoices.filter((i) => ['Unpaid', 'Rejected'].includes(i.payment_status))
  const verifying = invoices.filter((i) => i.payment_status === 'Slip Uploaded')
  const paid = invoices.filter((i) => i.payment_status === 'Paid')
  const toPayTotal = toPay.reduce((a, i) => a + i.total, 0)
  const toReceive = orders.filter((o) => ['Ready for Pickup', 'Out for Delivery'].includes(o.status))
  const live = orders.filter((o) => o.status !== 'Cancelled')
  const shown = orders.filter((o) => !status || o.status === status)

  return (
    <div>
      <div className="page-header">
        <h1>Purchase History</h1>
        <Link to="/portal" className="btn secondary"><Icon name="Plus" size={18} /> New order</Link>
      </div>

      <div className="two-col">
        <div className={`card pay-summary ${toPay.length ? 'tone-red' : 'tone-green'}`}>
          <h2>Invoices</h2>
          {toPay.length > 0 ? <>
            <div className="pay-summary-head">
              <span>To pay: <strong>{toPay.length} invoice{toPay.length > 1 ? 's' : ''}</strong></span>
              <strong className="pay-summary-total">{money(toPayTotal)}</strong>
            </div>
            <div className="inv-chips">
              {toPay.map((i) => (
                <span key={i.id} className={`inv-chip ${i.payment_status === 'Rejected' ? 'rejected' : ''}`} title={i.payment_status === 'Rejected' ? i.last_reject_reason : `Due ${fmtDay(i.due_date)}`}>
                  <span className="mono">{i.inv_number}</span> {money(i.total)}{i.payment_status === 'Rejected' && ' · slip rejected'}
                </span>
              ))}
            </div>
            <Link to="/portal/payments" className="btn primary block">Pay & upload slip</Link>
          </> : <p className="all-paid"><Icon name="CircleCheck" size={16} /> Nothing to pay.</p>}
          {verifying.length > 0 && <p className="small muted">Being verified: {verifying.map((i) => i.inv_number).join(', ')}</p>}
          <p className="small muted">{paid.length} invoice{paid.length === 1 ? '' : 's'} paid · all documents under <Link to="/portal/payments">Payments</Link></p>
        </div>

        <div className="card">
          <h2>To receive</h2>
          {toReceive.length === 0 && <p className="muted">Nothing on the way right now.</p>}
          {toReceive.map((o) => (
            <div key={o.id} className="todo-row tone-rose">
              <span>{o.method === 'pickup' ? `Collect ${o.so_number} on ${fmtDay(o.fulfil_date)}` : `${o.so_number} is on the way`} — check the items, then confirm</span>
              <Link to={`/portal/orders/${o.id}`} className="btn secondary small">Open</Link>
            </div>
          ))}
          <p className="small muted">{live.length} orders placed · {orders.filter((o) => ['Confirmed', 'Processing'].includes(o.status)).length} in our kitchen</p>
        </div>
      </div>

      <div className="card">
        <div className="toolbar">
          <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="">All orders</option>
            {['Confirmed', 'Processing', 'Ready for Pickup', 'Out for Delivery', 'Received', 'Cancelled'].map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Order #</th><th>Placed</th><th>Pickup / delivery</th><th className="num">Items</th><th>Status</th><th>Invoice</th><th className="num">Total</th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan="7" className="empty"><Icon name="Inbox" size={24} className="empty-icon" />No orders yet. <Link to="/portal">Start shopping</Link>.</td></tr>}
              {shown.map((o) => (
                <tr key={o.id} className={`clickable tone-${toneOf(o.status)}`} onClick={() => navigate(`/portal/orders/${o.id}`)}>
                  <td><strong>{o.so_number}</strong></td><td>{fmtDate(o.order_date)}</td>
                  <td>{o.method === 'pickup' ? 'Pickup' : 'Delivery'} · {fmtDay(o.fulfil_date)}</td>
                  <td className="num">{o.unit_count} units</td>
                  <td><StatusBadge status={o.status} label={o.status === 'Confirmed' ? 'Order placed' : o.status === 'Processing' ? 'In production' : undefined} /></td>
                  <td>{o.inv_number
                    ? <><span className="mono small">{o.inv_number}</span> <StatusBadge status={o.payment_status} /></>
                    : o.status === 'Cancelled' ? <span className="muted">—</span> : <span className="muted small">{o.order_slip_status ? 'Slip sent · invoice coming' : 'Invoice coming'}</span>}</td>
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
