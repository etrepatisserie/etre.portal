import { useEffect, useState, useRef } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, fmtDay, fmtDayLong, fmtDateTime } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import NextStep from '../../components/NextStep.jsx'
import Icon from '../../components/Icon.jsx'

// Printable PO / production sheet. Printing is recorded, and unlocks "Mark as Processing".
export default function OrderSheet() {
  const { id } = useParams()
  const [o, setO] = useState(null)
  const [error, setError] = useState('')
  const [params] = useSearchParams()
  const autoPrinted = useRef(false)
  useEffect(() => { api.get(`/kitchen/orders/${id}`).then(setO).catch((e) => setError(e.message)) }, [id])

  const print = async () => {
    setError('')
    try { setO(await api.post(`/kitchen/orders/${id}/printed`)); setTimeout(() => window.print(), 50) } catch (e) { setError(e.message) }
  }
  const processing = async () => {
    setError('')
    try { setO(await api.post(`/kitchen/orders/${id}/processing`)); window.dispatchEvent(new Event('notifications:refresh')) } catch (e) { setError(e.message) }
  }
  // "Print sheet" from the orders list opens this page with ?print=1
  useEffect(() => {
    if (o && params.get('print') === '1' && !autoPrinted.current) { autoPrinted.current = true; print() }
  }, [o])
  if (!o) return error ? <div className="alert error">{error}</div> : <p>Loading…</p>

  let next
  if (o.can_start && !o.printed_at) next = <NextStep status="Confirmed" title="Step 1 of 2 — print the production sheet" actions={<button className="btn primary" onClick={print}><Icon name="Printer" size={18} /> Print sheet</button>}>Make on <strong>{fmtDayLong(o.production_date)}</strong>.</NextStep>
  else if (o.can_start) next = <NextStep status="Confirmed" title="Step 2 of 2 — start production" actions={<><button className="btn primary" onClick={processing}><Icon name="Play" size={18} /> Start production</button><button className="btn ghost" onClick={print}>Print again</button></>}>This tells Admin and the customer the order is being made.</NextStep>
  else if (o.status === 'Processing') next = <NextStep status="Processing" kind="done" title="In production" actions={<button className="btn ghost" onClick={print}>Print again</button>}>Admin will dispatch it on {fmtDayLong(o.fulfil_date)}. Remember to record what you produce in Production Plan.</NextStep>
  else next = <NextStep status={o.status} kind="done" title={`${o.status} — nothing to do`} />

  return (
    <div>
      <div className="page-header no-print">
        <div>
          <div className="breadcrumb"><Link to="/kitchen">Orders</Link> / {o.so_number}</div>
          <h1>{o.so_number} <StatusBadge status={o.status} label={o.status === 'Confirmed' ? 'New order' : o.status === 'Processing' ? 'In production' : undefined} /></h1>
        </div>
      </div>
      {error && <div className="alert error no-print">{error}</div>}
      <div className="no-print">{next}</div>

      <div className="card print-sheet">
        <div className="sheet-head">
          <div><div className="sheet-brand">ÊTRE PATISSERIE</div><div className="muted small">Central Kitchen · Production sheet</div></div>
          <div className="sheet-no">{o.so_number}</div>
        </div>
        <div className="sheet-grid">
          <div><div className="label">Customer</div><strong>{o.customer_name}</strong> ({o.customer_code})<div className="small">{o.customer_phone}</div></div>
          <div><div className="label">Order date</div>{fmtDateTime(o.order_date)}</div>
          <div><div className="label">Production date</div><strong className="big">{fmtDayLong(o.production_date)}</strong></div>
          <div><div className="label">{o.method === 'pickup' ? 'Pickup' : 'Delivery'}</div><strong className="big">{fmtDayLong(o.fulfil_date)}</strong><div>{o.time_slot}</div></div>
          <div><div className="label">Method</div>{o.method === 'pickup' ? 'Customer pickup at outlet' : 'Delivery'}{o.delivery_address && <div className="small">{o.delivery_address}</div>}</div>
          {o.notes && <div><div className="label">Notes</div>{o.notes}</div>}
        </div>
        <table className="sheet-table">
          <thead><tr><th>#</th><th>SKU</th><th>Item</th><th>Size</th><th className="num">Qty</th><th className="tick">Made</th><th className="tick">Packed</th></tr></thead>
          <tbody>{o.lines.map((l, i) => (
            <tr key={l.id}><td>{i + 1}</td><td className="mono">{l.sku}</td><td><strong>{l.description}</strong></td><td>{l.size}</td><td className="num big">{l.quantity} {l.uom}</td><td className="tick">☐</td><td className="tick">☐</td></tr>
          ))}</tbody>
          <tfoot><tr><td colSpan="4">Total units</td><td className="num big">{o.lines.reduce((a, l) => a + l.quantity, 0)}</td><td colSpan="2"></td></tr></tfoot>
        </table>
        <div className="sheet-sign"><span>Prepared by ____________________</span><span>Checked by ____________________</span></div>
        <div className="muted small">{o.printed_at ? `Printed ${fmtDateTime(o.printed_at)}` : 'Not printed yet'} · {fmtDay(o.production_date)}</div>
      </div>
    </div>
  )
}
