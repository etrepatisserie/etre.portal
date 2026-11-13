import { useEffect, useState, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, money, fmtDateTime, fmtDay } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import FileLink from '../../components/FileLink.jsx'
import OutletTag, { useShowOutlet } from '../../components/OutletTag.jsx'
import Icon from '../../components/Icon.jsx'

// Customer complaints (reported when marking an order as received).
// Every complaint is settled with a credit note (Finance issues it) or a no-charge replacement order.
function CreditNoteForm({ d, onDone, onBack }) {
  const [qty, setQty] = useState(d.qty || d.line_qty || 1)
  const [reason, setReason] = useState(`${d.product_name}: ${d.note}`)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const total = Math.round((Number(qty) || 0) * d.unit_price * (1 + d.sst_rate) * 100) / 100
  const send = async () => {
    setError(''); setBusy(true)
    try { await api.post(`/admin/discrepancies/${d.id}/credit-note`, { qty: Number(qty), reason }); onDone(`Credit note request sent to Finance (${money(total)}).`) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="resolve-form">
      <div className="form-grid">
        <label>Quantity to credit<input type="number" min="1" max={d.line_qty} value={qty} onChange={(e) => setQty(e.target.value)} /><span className="muted small">{d.line_qty} on the order · {money(d.unit_price)} each</span></label>
        <label className="span-2">Reason (printed on the credit note)<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      </div>
      {error && <div className="alert error small">{error}</div>}
      <div className="row-actions"><button className="btn primary" disabled={busy || !(Number(qty) > 0)} onClick={send}>Send to Finance · {money(total)} incl. SST</button><button className="btn ghost" onClick={onBack}>Back</button></div>
      <p className="muted small">Finance gets an alert and issues the credit note. It is deducted from what the customer owes, or refunded / offset if the invoice is already paid.</p>
    </div>
  )
}

function ReplacementForm({ d, onDone, onBack }) {
  const [info, setInfo] = useState(null)
  const [qty, setQty] = useState(d.qty || d.line_qty || 1)
  const [method, setMethod] = useState(d.method)
  const [date, setDate] = useState('')
  const [slot, setSlot] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.get(`/admin/checkout-info?customer_id=${d.customer_id}`).then((i) => { setInfo(i); setDate(i.window.dates[0]) }) }, [d.customer_id])
  const slots = info ? (method === 'pickup' ? info.pickup_slots : info.delivery_slots) : []
  const chosenSlot = slots.includes(slot) ? slot : slots[0]
  const send = async () => {
    setError(''); setBusy(true)
    try {
      const r = await api.post(`/admin/discrepancies/${d.id}/replacement`, { qty: Number(qty), method, fulfil_date: date, time_slot: chosenSlot })
      onDone(<>Replacement order <Link to={`/admin/sales/${r.id}`}>{r.so_number}</Link> sent to the kitchen — no charge.</>)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  if (!info) return <p className="muted small">Loading dates…</p>
  return (
    <div className="resolve-form">
      <div className="form-grid">
        <label>Quantity<input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} /><span className="muted small">{d.product_name}</span></label>
        <label>Pickup or delivery<select value={method} onChange={(e) => setMethod(e.target.value)}><option value="delivery">Delivery</option><option value="pickup">Pickup</option></select></label>
        <label>Date<select value={date} onChange={(e) => setDate(e.target.value)}>{info.window.dates.map((x) => <option key={x} value={x}>{fmtDay(x)}</option>)}</select></label>
        <label>Time slot<select value={chosenSlot} onChange={(e) => setSlot(e.target.value)}>{slots.map((s) => <option key={s}>{s}</option>)}</select></label>
      </div>
      {error && <div className="alert error small">{error}</div>}
      <div className="row-actions"><button className="btn primary" disabled={busy || !(Number(qty) > 0)} onClick={send}>Create replacement order · no charge</button><button className="btn ghost" onClick={onBack}>Back</button></div>
      <p className="muted small">Goes straight to the {info.outlet.name} kitchen like a normal order, at RM 0 — Finance does not invoice it.</p>
    </div>
  )
}

function Outcome({ d }) {
  if (d.action === 'replacement') return <span className="small"><Icon name="RotateCcw" size={16} /> Replacement <Link to={`/admin/sales/${d.replacement_so_id}`} className="mono">{d.replacement_so_number}</Link> <StatusBadge status={d.replacement_status} /></span>
  if (d.action === 'credit_note' && d.credit_note) {
    const cn = d.credit_note
    return <span className="small"><Icon name="FileMinus" size={16} /> Credit note {cn.status === 'Issued'
      ? <><FileLink url={`/documents/credit-notes/${cn.id}`}>{cn.cn_number}</FileLink> · {money(cn.total)} <StatusBadge status="Issued" /></>
      : <>{money(cn.total)} <StatusBadge status="Requested" label="With Finance" /></>}</span>
  }
  return <span className="small">{d.resolution}</span>
}

export default function Discrepancies() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('status') || 'Open'
  const [rows, setRows] = useState([])
  const [open, setOpen] = useState({}) // id → 'cn' | 'rep'
  const [msg, setMsg] = useState(null)
  const showOutlet = useShowOutlet()
  const load = useCallback(() => api.get(`/admin/discrepancies?status=${tab}`).then(setRows), [tab])
  useEffect(() => { load() }, [load])
  const done = (text) => { setMsg(text); setOpen({}); load(); window.dispatchEvent(new Event('notifications:refresh')) }

  return (
    <div>
      <div className="page-header"><h1>Customer Complaints</h1></div>
      <p className="muted">Problems customers reported when receiving an order. Settle each one with a <strong>credit note</strong> (Finance issues it) or a <strong>replacement</strong> (a no-charge order to the kitchen).</p>
      <div className="chips">{['Open', 'Resolved', 'All'].map((t) => <button key={t} className={`chip ${tab === t ? 'on' : ''}`} onClick={() => setParams({ status: t })}>{t === 'Open' ? 'To resolve' : t}</button>)}</div>
      {msg && <div className="alert success">{msg}</div>}
      {rows.length === 0 && <div className="card"><p className="empty"><Icon name="CircleCheck" size={24} className="empty-icon" />{tab === 'Open' ? 'No open complaints.' : 'Nothing here.'}</p></div>}
      {rows.map((d) => (
        <div key={d.id} className={`card complaint ${d.status === 'Open' ? 'is-open' : ''}`}>
          <div className="complaint-head">
            <div>
              <strong>{d.customer_name}</strong>{showOutlet && <OutletTag code={d.outlet_code} />} · <Link to={`/admin/sales/${d.so_id}`} className="mono">{d.so_number}</Link>
              {d.replacement_for ? <span className="tag">replacement order</span> : null}
              <div className="muted small">Reported {fmtDateTime(d.created_at)}</div>
            </div>
            <StatusBadge status={d.status} />
          </div>
          <p className="complaint-item"><strong>{d.product_name}</strong>{d.qty != null ? ` · qty ${d.qty}` : ''} — {d.note}{d.file_id && <> · <FileLink url={`/files/${d.file_id}`}>View photo</FileLink></>}</p>
          {d.status === 'Open' ? <>
            {d.resolution && <div className="alert error small">{d.resolution}</div>}
            {!open[d.id] && <div className="row-actions">
              <button className="btn primary" disabled={!!d.replacement_for} title={d.replacement_for ? 'Replacement orders are free — offer another replacement' : ''} onClick={() => setOpen({ [d.id]: 'cn' })}><Icon name="FileMinus" size={18} /> Offer credit note</button>
              <button className="btn secondary" onClick={() => setOpen({ [d.id]: 'rep' })}><Icon name="RotateCcw" size={18} /> Send replacement</button>
            </div>}
            {open[d.id] === 'cn' && <CreditNoteForm d={d} onDone={done} onBack={() => setOpen({})} />}
            {open[d.id] === 'rep' && <ReplacementForm d={d} onDone={done} onBack={() => setOpen({})} />}
          </> : <div className="complaint-outcome"><Outcome d={d} /><span className="muted small">{d.resolved_by_name} · {fmtDateTime(d.resolved_at)}</span></div>}
        </div>
      ))}
    </div>
  )
}
