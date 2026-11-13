import { useEffect, useState, useRef } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { api, fmtDay, fmtDayLong, fmtDateTime } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import NextStep from '../../components/NextStep.jsx'
import Icon from '../../components/Icon.jsx'

// Printable PO / production sheet. Printing is recorded, and unlocks "Mark as Processing".
// Step 3: actual quantity per line (defaults to the ordered quantity), wastage and remarks
function CompleteForm({ o, onDone }) {
  const [rows, setRows] = useState(() => Object.fromEntries(o.lines.map((l) => [l.id, { actual_qty: l.quantity, wastage: 0, remarks: '' }])))
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = (id, k, v) => setRows({ ...rows, [id]: { ...rows[id], [k]: v } })
  const save = async () => {
    setError(''); setBusy(true)
    try { onDone(await api.post(`/kitchen/orders/${o.id}/complete`, { lines: o.lines.map((l) => ({ line_id: l.id, ...rows[l.id], actual_qty: Number(rows[l.id].actual_qty), wastage: Number(rows[l.id].wastage) })), remarks })) }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="complete-form">
      <div className="table-wrap"><table>
        <thead><tr><th>Item</th><th className="num">Ordered</th><th className="num">Made</th><th className="num">Short</th><th className="num">Wastage</th><th>Remarks</th></tr></thead>
        <tbody>{o.lines.map((l) => { const r = rows[l.id]; const short = Math.max(0, l.quantity - Number(r.actual_qty || 0)); return (
          <tr key={l.id}><td><strong>{l.description}</strong><div className="muted small">{l.sku}</div></td><td className="num">{l.quantity}</td>
            <td className="num"><input type="number" min="0" className="qty-input" value={r.actual_qty} onChange={(e) => set(l.id, 'actual_qty', e.target.value)} aria-label={`${l.description} made`} /></td>
            <td className={`num ${short ? 'neg' : 'muted'}`}>{short || '—'}</td>
            <td className="num"><input type="number" min="0" className="qty-input" value={r.wastage} onChange={(e) => set(l.id, 'wastage', e.target.value)} aria-label={`${l.description} wastage`} /></td>
            <td><input value={r.remarks} onChange={(e) => set(l.id, 'remarks', e.target.value)} placeholder="optional" aria-label={`${l.description} remarks`} /></td></tr>
        ) })}</tbody>
      </table></div>
      <label className="field">Production remarks <span className="optional">(optional)</span><input value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="e.g. Oven 2 ran hot" /></label>
      {error && <div className="alert error"><Icon name="AlertCircle" size={18} /><span>{error}</span></div>}
      <div className="actions"><button className="btn primary" disabled={busy} onClick={save}><Icon name="CircleCheck" size={18} /> {busy ? 'Saving…' : 'Mark completed'}</button></div>
    </div>
  )
}

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
  if (o.can_start && !o.printed_at) next = <NextStep status="Confirmed" title="Step 1 of 3 — print the production sheet" actions={<button className="btn primary" onClick={print}><Icon name="Printer" size={18} /> Print sheet</button>}>Make on <strong>{fmtDayLong(o.production_date)}</strong>.</NextStep>
  else if (o.can_start) next = <NextStep status="Confirmed" title="Step 2 of 3 — start production" actions={<><button className="btn primary" onClick={processing}><Icon name="Play" size={18} /> Start production</button><button className="btn ghost" onClick={print}>Print again</button></>}>This tells Admin and the customer the order is being made.</NextStep>
  else if (o.status === 'Processing' && !o.completed_at) next = (
    <NextStep status="Processing" title="Step 3 of 3 — mark it completed" actions={<button className="btn ghost" onClick={print}>Print again</button>}>
      <p>When it's made, record what you actually produced for this order. Anything short is sent to Admin straight away.</p>
      <CompleteForm o={o} onDone={setO} />
    </NextStep>
  )
  else if (o.completed_at) next = (
    <NextStep status="Received" kind="done" title="Completed — Admin dispatches it" actions={o.status === 'Processing' && <button className="btn ghost" onClick={print}>Print again</button>}>
      {o.production_results.some((r) => r.shortage > 0) ? <p className="neg">Short: {o.production_results.filter((r) => r.shortage > 0).map((r) => `${o.lines.find((l) => l.id === r.line_id)?.description} ${r.shortage}`).join(', ')} — Admin has been told.</p> : <p>Everything made as ordered.</p>}
    </NextStep>
  )
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
          {o.addon_of_number && <div className="sheet-flag">ADD-ON to {o.addon_of_number}</div>}
          {o.changed_after_approval && <div className="sheet-flag">CHANGED AFTER APPROVAL — check quantities</div>}
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
