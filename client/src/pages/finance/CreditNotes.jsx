import { useEffect, useState, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, money, fmtDay, fmtDateTime } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import FileLink from '../../components/FileLink.jsx'
import OutletTag, { useShowOutlet } from '../../components/OutletTag.jsx'
import Icon from '../../components/Icon.jsx'
import Flash from '../../components/Flash.jsx'
import { useConfirm } from '../../feedback.js'

// Credit notes: requests from Admin (customer complaints) to issue or decline, plus Finance's own credit notes.
const TABS = [['Requested', 'To issue'], ['Issued', 'Issued'], ['Rejected', 'Declined'], ['', 'All']]
const LABEL = { Requested: 'To issue', Rejected: 'Declined' }

function Request({ cn, onDone }) {
  const confirm = useConfirm()
  const [qty, setQty] = useState(cn.lines[0]?.quantity ?? 1)
  const [reason, setReason] = useState(cn.reason)
  const [decline, setDecline] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const l = cn.lines[0]
  const sub = Math.round((Number(qty) || 0) * l.unit_price * 100) / 100
  const total = Math.round(sub * (1 + cn.sst_rate) * 100) / 100
  const act = async (fn) => { setError(''); setBusy(true); try { onDone(await fn()) } catch (e) { setError(e.message) } finally { setBusy(false) } }
  const issue = () => act(() => api.post(`/finance/credit-notes/${cn.id}/issue`, { items: [{ line_id: l.line_id, qty: Number(qty) }], reason }))
  const reject = async () => {
    if (!await confirm({ title: `Decline credit note request for ${cn.customer_name}?`, body: 'The complaint goes back to Admin to resolve another way.', confirmLabel: 'Decline request', danger: true })) return
    act(() => api.post(`/finance/credit-notes/${cn.id}/reject`, { reason: decline }))
  }
  return (
    <div className="cn-card card">
      <div className="cn-head">
        <div><strong>{cn.customer_name}</strong> <StatusBadge status={cn.payment_term} /><div className="muted small">Order <span className="mono">{cn.so_number}</span> · requested by {cn.requested_by_name || 'Admin'} · {fmtDateTime(cn.requested_at)}</div></div>
        <div className="num"><div className="stat-label">Credit (incl. SST)</div><strong className="cn-amt">{money(total)}</strong></div>
      </div>
      {cn.complaint_note && <p className="small cn-complaint">Customer reported: “{cn.complaint_note}”{cn.complaint_file_id && <> · <FileLink url={`/files/${cn.complaint_file_id}`}>photo</FileLink></>}</p>}
      <div className="cn-grid">
        <div><div className="label">Item</div>{l.description}<div className="muted small">{money(l.unit_price)} each</div></div>
        <label className="field">Quantity to credit<input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} /></label>
        <div><div className="label">Invoice</div>{cn.inv_number
          ? <><span className="mono">{cn.inv_number}</span> <StatusBadge status={cn.invoice_payment_status} />{cn.invoice_payment_status === 'Paid' && <div className="muted small">Already paid → refund or offset</div>}</>
          : <span className="neg small">Not invoiced yet — issue the invoice first</span>}</div>
      </div>
      <label className="field">Reason on the credit note<input value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {error && <div className="alert error small">{error}</div>}
      {decline == null
        ? <div className="row-actions"><button className="btn primary" disabled={busy || !cn.inv_number || !(Number(qty) > 0)} onClick={issue}>Issue credit note · {money(total)}</button>
            {!cn.inv_number && <Link className="btn secondary" to={`/finance/invoices/new/${cn.so_id}`}>Issue invoice</Link>}
            <button className="btn ghost" onClick={() => setDecline('')}>Decline</button></div>
        : <div className="input-row"><input autoFocus placeholder="Why? Admin will offer something else" value={decline} onChange={(e) => setDecline(e.target.value)} />
            <button className="btn danger small" disabled={busy || !decline.trim()} onClick={reject}>Decline</button><button className="btn ghost small" onClick={() => setDecline(null)}>Back</button></div>}
    </div>
  )
}

// Finance's own credit note on any invoice: pick the invoice, the quantities and the reason
function NewCreditNote({ invoiceId, onDone, onClose }) {
  const [q, setQ] = useState('')
  const [found, setFound] = useState([])
  const [inv, setInv] = useState(null)
  const [order, setOrder] = useState(null)
  const [qty, setQty] = useState({})
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pick = useCallback((i) => { setInv(i); setQty({}); setError(''); api.get(`/finance/orders/${i.so_id}`).then(setOrder) }, [])
  useEffect(() => { if (q.trim().length >= 2) api.get(`/finance/invoices?q=${encodeURIComponent(q)}`).then(setFound) }, [q])
  useEffect(() => {
    if (invoiceId) api.get('/finance/invoices').then((rows) => { const i = rows.find((r) => r.id === Number(invoiceId)); if (i) pick(i) })
  }, [invoiceId, pick])
  const lines = order ? order.lines.filter((l) => l.quantity > 0) : []
  const sub = lines.reduce((a, l) => a + (Number(qty[l.id]) || 0) * l.unit_price, 0)
  const total = Math.round(sub * (1 + (order?.sst_rate || 0)) * 100) / 100
  const items = Object.entries(qty).filter(([, v]) => Number(v) > 0).map(([id, v]) => ({ line_id: Number(id), qty: Number(v) }))
  const save = async () => {
    setError(''); setBusy(true)
    try { const cn = await api.post('/finance/credit-notes', { invoice_id: inv.id, items, reason }); onDone(cn) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="card">
      <div className="card-head"><h2>New credit note</h2><button className="btn ghost small" onClick={onClose}>Close</button></div>
      {!inv ? <>
        <label className="field">Find the invoice<input autoFocus placeholder="Invoice no., order no. or customer…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
        {(q.trim().length >= 2 ? found : []).slice(0, 8).map((i) => (
          <button key={i.id} type="button" className="demo-row" onClick={() => pick(i)}>
            <span><span className="mono">{i.inv_number}</span> · {i.customer_name}<span className="muted small"> · {fmtDay(i.issue_date)}</span></span>
            <span>{money(i.total)} <StatusBadge status={i.payment_status} /></span>
          </button>
        ))}
      </> : <>
        <p><span className="mono">{inv.inv_number}</span> · {inv.customer_name} · {money(inv.total)}{inv.credited > 0 && <span className="muted"> · {money(inv.credited)} already credited</span>} <button className="btn ghost small" onClick={() => { setInv(null); setOrder(null) }}>Change</button></p>
        <div className="table-wrap"><table>
          <thead><tr><th>Item</th><th className="num">Invoiced</th><th className="num">Unit price</th><th className="num">Credit qty</th><th className="num">Amount</th></tr></thead>
          <tbody>{lines.map((l) => (
            <tr key={l.id}><td>{l.description}</td><td className="num">{l.quantity}</td><td className="num">{money(l.unit_price)}</td>
              <td className="num"><input className="qty-input" type="number" min="0" max={l.quantity} value={qty[l.id] ?? ''} placeholder="0" aria-label={`Credit quantity for ${l.description}`} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} /></td>
              <td className="num">{money((Number(qty[l.id]) || 0) * l.unit_price)}</td></tr>
          ))}</tbody>
        </table></div>
        <label className="field">Reason *<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. 3 croissants damaged in delivery" /></label>
        {error && <div className="alert error small">{error}</div>}
        <button className="btn primary" disabled={busy || !items.length || !reason.trim()} onClick={save}>Issue credit note · {money(total)} incl. SST</button>
      </>}
    </div>
  )
}

export default function CreditNotes() {
  const [params, setParams] = useSearchParams()
  const status = params.has('status') ? params.get('status') : 'Requested'
  const newFor = params.get('invoice')
  const [rows, setRows] = useState([])
  const [creating, setCreating] = useState(!!newFor)
  const [msg, setMsg] = useState('')
  const showOutlet = useShowOutlet()
  const load = useCallback(() => api.get(`/finance/credit-notes${status ? `?status=${status}` : ''}`).then(setRows), [status])
  useEffect(() => { load() }, [load])
  const done = (cn) => { setMsg(cn?.cn_number ? `${cn.cn_number} issued — ${money(cn.total)}. The customer has been emailed.` : 'Declined — the complaint is back with Admin.'); load(); window.dispatchEvent(new Event('notifications:refresh')) }

  return (
    <div>
      <div className="page-header">
        <div><h1>Credit Notes</h1><div className="muted">Admin sends a request when a customer complaint is settled with a credit note. You can also raise one on any invoice.</div></div>
        {!creating && <button className="btn secondary" onClick={() => setCreating(true)}><Icon name="Plus" size={18} /> New credit note</button>}
      </div>
      <Flash msg={msg} />
      {creating && <NewCreditNote invoiceId={newFor} onClose={() => { setCreating(false); if (newFor) setParams({}) }} onDone={(cn) => { setCreating(false); setParams({ status: 'Issued' }); done(cn) }} />}
      <div className="chips">{TABS.map(([v, l]) => <button key={l} className={`chip ${status === v ? 'on' : ''}`} onClick={() => setParams({ status: v })}>{l}</button>)}</div>

      {status === 'Requested' ? (
        rows.length === 0 ? <div className="card"><p className="empty"><Icon name="CircleCheck" size={24} className="empty-icon" />No credit notes waiting.</p></div>
          : rows.map((cn) => <Request key={cn.id} cn={cn} onDone={done} />)
      ) : (
        <div className="card"><div className="table-wrap"><table>
          <thead><tr><th>Credit note</th><th>Customer</th><th>Invoice</th><th>Reason</th><th>Status</th><th className="num">Amount</th><th>PDF</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan="7" className="empty"><Icon name="Inbox" size={24} className="empty-icon" />Nothing here.</td></tr>}
            {rows.map((cn) => (
              <tr key={cn.id}>
                <td className="mono">{cn.cn_number || '—'}{showOutlet && <OutletTag code={cn.outlet_code} />}<div className="muted small">{cn.issue_date ? fmtDay(cn.issue_date) : fmtDateTime(cn.requested_at)}{cn.discrepancy_id ? ' · complaint' : ''}</div></td>
                <td>{cn.customer_name}</td>
                <td className="mono">{cn.inv_number || '—'}<div className="muted small">{cn.so_number}</div></td>
                <td className="small">{cn.reason}{cn.settlement && <div className="muted">{cn.settlement}</div>}{cn.reject_reason && <div className="neg">Declined: {cn.reject_reason}</div>}</td>
                <td><StatusBadge status={cn.status} label={LABEL[cn.status]} tone={cn.status === 'Rejected' ? 'gray' : undefined} icon={cn.status === 'Rejected' ? 'Ban' : undefined} /></td>
                <td className="num">{money(cn.total)}</td>
                <td>{cn.status === 'Issued' && <FileLink url={`/documents/credit-notes/${cn.id}`}>View</FileLink>}</td>
              </tr>
            ))}
          </tbody>
        </table></div></div>
      )}
    </div>
  )
}
