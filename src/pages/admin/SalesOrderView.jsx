import { useEffect, useState, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, money, fmtDateTime } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import { Stepper, EventList } from '../../components/Timeline.jsx'

const NEXT = {
  Pending: [['Confirmed', 'Confirm order', 'primary']],
  Confirmed: [['Packed', 'Mark as packed', 'primary']],
  Packed: [['Shipped', 'Ship order…', 'primary']],
  Shipped: [['Delivered', 'Mark as delivered', 'primary']],
}
const CARRIERS = ['DHL Express', 'FedEx', 'City Courier', 'Own delivery van']

export default function SalesOrderView() {
  const { id } = useParams()
  const [so, setSo] = useState(null)
  const [error, setError] = useState('')
  const [shipping, setShipping] = useState(false)
  const [ship, setShip] = useState({ carrier: CARRIERS[0], tracking_no: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => api.get(`/admin/sales-orders/${id}`).then(setSo).catch((e) => setError(e.message)), [id])
  useEffect(() => { load() }, [load])

  const change = async (status, extra = {}) => {
    if (status === 'Cancelled' && !confirm(`Cancel ${so.so_number}? Reserved stock will be released.`)) return
    setError(''); setBusy(true)
    try {
      await api.post(`/admin/sales-orders/${id}/status`, { status, ...extra })
      setShipping(false); load()
      window.dispatchEvent(new Event('notifications:refresh'))
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  if (error && !so) return <div className="alert error">{error}</div>
  if (!so) return <p>Loading…</p>
  const canCancel = ['Pending', 'Confirmed', 'Packed'].includes(so.status)

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="breadcrumb"><Link to="/admin/sales">Sales Orders</Link> / {so.so_number}</div>
          <h1>{so.so_number} <StatusBadge status={so.status} /></h1>
          <div className="muted">Placed {fmtDateTime(so.order_date)}</div>
        </div>
        <div className="actions inline">
          {(NEXT[so.status] || []).map(([s, label, style]) => (
            <button key={s} className={`btn ${style}`} disabled={busy}
              onClick={() => (s === 'Shipped' ? setShipping(true) : change(s))}>{label}</button>
          ))}
          {canCancel && <button className="btn danger" disabled={busy} onClick={() => change('Cancelled')}>Cancel order</button>}
          <button className="btn ghost" onClick={() => window.print()}>Print</button>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}

      {shipping && (
        <div className="card highlight">
          <h2>Ship order</h2>
          <p className="muted small">Shipping deducts the items from stock on hand and notifies the customer.</p>
          <div className="grid-form">
            <label>Carrier
              <select value={ship.carrier} onChange={(e) => setShip({ ...ship, carrier: e.target.value })}>
                {CARRIERS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label>Tracking number
              <input value={ship.tracking_no} onChange={(e) => setShip({ ...ship, tracking_no: e.target.value })} placeholder="e.g. TRK12345678" />
            </label>
          </div>
          <div className="actions">
            <button className="btn ghost" onClick={() => setShipping(false)}>Back</button>
            <button className="btn primary" disabled={busy} onClick={() => change('Shipped', ship)}>Confirm shipment</button>
          </div>
        </div>
      )}

      <div className="card">
        <Stepper status={so.status} />
        <div className="info-grid">
          <div>
            <div className="label">Customer</div>
            <div><strong>{so.customer_name}</strong> ({so.customer_code})</div>
            <div className="muted">{so.customer_contact} · {so.customer_email}</div>
            <div className="muted">{so.customer_phone}</div>
          </div>
          <div><div className="label">Deliver to</div><div>{so.delivery_address || '—'}</div>
            {so.notes && <><div className="label">Customer notes</div><div>{so.notes}</div></>}</div>
          <div><div className="label">Carrier</div><div>{so.carrier || '—'}</div>
            <div className="label">Tracking</div><div>{so.tracking_no ? <code>{so.tracking_no}</code> : '—'}</div></div>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <h2>Items</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>SKU</th><th>Product</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {so.lines.map((l) => (
                  <tr key={l.id}><td>{l.sku}</td><td>{l.description}</td><td className="num">{l.quantity} {l.uom}</td>
                    <td className="num">{money(l.unit_price)}</td><td className="num">{money(l.line_total)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="totals"><div className="grand"><span>Total</span><span>{money(so.total)}</span></div></div>
        </div>
        <div className="card"><h2>History</h2><EventList events={so.events} /></div>
      </div>
    </div>
  )
}
