import { useEffect, useState, useCallback } from 'react'
import { Link, useParams, useLocation, useOutletContext, useNavigate } from 'react-router-dom'
import { api, money, fmtDateTime } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import { Stepper, EventList } from '../../components/Timeline.jsx'

export default function OrderDetail() {
  const { id } = useParams()
  const { state } = useLocation()
  const { cart, setCart } = useOutletContext()
  const navigate = useNavigate()
  const [so, setSo] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => api.get(`/customer/orders/${id}`).then(setSo).catch((e) => setError(e.message)), [id])
  useEffect(() => { load() }, [load])

  const cancel = async () => {
    if (!confirm(`Cancel order ${so.so_number}?`)) return
    try { await api.post(`/customer/orders/${id}/cancel`); load(); window.dispatchEvent(new Event('notifications:refresh')) }
    catch (e) { setError(e.message) }
  }

  // "Buy again" — puts the same lines into the cart (limited by what's available now)
  const reorder = async () => {
    const products = await api.get('/customer/products')
    const next = { ...cart }
    for (const l of so.lines) {
      const p = products.find((x) => x.id === l.product_id)
      if (p && p.available > 0) next[p.id] = { product: p, qty: Math.min(p.available, (next[p.id]?.qty || 0) + l.quantity) }
    }
    setCart(next)
    navigate('/portal')
  }

  if (error && !so) return <div className="alert error">{error}</div>
  if (!so) return <p>Loading…</p>

  return (
    <div>
      {state?.placed && <div className="alert success">✓ Thank you! Order {so.so_number} has been placed and the stock is reserved for you.</div>}
      <div className="page-header">
        <div>
          <div className="breadcrumb"><Link to="/portal/orders">Purchase History</Link> / {so.so_number}</div>
          <h1>{so.so_number} <StatusBadge status={so.status} /></h1>
          <div className="muted">Placed {fmtDateTime(so.order_date)}</div>
        </div>
        <div className="actions inline">
          {so.status === 'Pending' && <button className="btn danger" onClick={cancel}>Cancel order</button>}
          <button className="btn secondary" onClick={reorder}>Buy again</button>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}

      <div className="card">
        <h2>Delivery status</h2>
        <Stepper status={so.status} />
        <div className="info-grid">
          <div><div className="label">Deliver to</div><div>{so.delivery_address || '—'}</div></div>
          <div><div className="label">Carrier</div><div>{so.carrier || 'Assigned when shipped'}</div></div>
          <div><div className="label">Tracking number</div><div>{so.tracking_no ? <code>{so.tracking_no}</code> : '—'}</div></div>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <h2>Items</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {so.lines.map((l) => (
                  <tr key={l.id}><td>{l.description}<div className="muted small">{l.sku}</div></td>
                    <td className="num">{l.quantity} {l.uom}</td><td className="num">{money(l.unit_price)}</td><td className="num">{money(l.line_total)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="totals"><div className="grand"><span>Total</span><span>{money(so.total)}</span></div></div>
          {so.notes && <><div className="label">Your notes</div><p>{so.notes}</p></>}
        </div>
        <div className="card">
          <h2>History</h2>
          <EventList events={so.events} />
        </div>
      </div>
    </div>
  )
}
