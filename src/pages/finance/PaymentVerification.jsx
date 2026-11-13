import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api, fetchBlob, money, fmtDateTime, fmtDay } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import FileLink from '../../components/FileLink.jsx'
import CustomerFilter, { matchesCustomer } from '../../components/CustomerFilter.jsx'
import OutletTag, { useShowOutlet } from '../../components/OutletTag.jsx'
import Icon from '../../components/Icon.jsx'
import Flash from '../../components/Flash.jsx'
import { useConfirm } from '../../feedback.js'

// Queue of payment slips: the slip next to its invoice, then Mark as Paid or Reject with a reason.
// COD slips arrive with the order — issue the invoice first, then verify.
export default function PaymentVerification() {
  const confirm = useConfirm()
  const [tab, setTab] = useState('Pending')
  const [customer, setCustomer] = useState('')
  const showOutlet = useShowOutlet()
  const [slips, setSlips] = useState([])
  const [sel, setSel] = useState(null)
  const [preview, setPreview] = useState(null)
  const [invPreview, setInvPreview] = useState(null)
  const [reason, setReason] = useState('')
  const [msg, setMsg] = useState(null)
  const load = useCallback(() => api.get(`/finance/slips?status=${tab}`).then(setSlips), [tab])
  useEffect(() => { load() }, [load])

  const shown = slips.filter((s) => matchesCustomer(s.customer_name, customer))
  useEffect(() => { setSel((s) => shown.find((x) => x.id === s?.id) || shown[0] || null) }, [slips, customer]) // eslint-disable-line react-hooks/exhaustive-deps

  // load the slip + its invoice as blobs (they need the login token)
  useEffect(() => {
    const urls = []
    setPreview(null); setInvPreview(null); setReason('')
    if (!sel) return
    fetchBlob(`/files/${sel.file_id}`).then((b) => { const u = URL.createObjectURL(b); urls.push(u); setPreview({ url: u, type: b.type }) }).catch(() => {})
    if (sel.invoices[0]) fetchBlob(`/documents/invoices/${sel.invoices[0].id}/invoice`).then((b) => { const u = URL.createObjectURL(b); urls.push(u); setInvPreview({ url: u, type: b.type }) }).catch(() => {})
    return () => urls.forEach((u) => URL.revokeObjectURL(u))
  }, [sel?.id])

  const act = async (kind) => {
    setMsg(null)
    if (kind === 'reject' && !await confirm({ title: 'Reject this payment slip?', body: <>The customer is told the reason: <em>“{reason.trim()}”</em>. Their invoice stays unpaid and new orders stay on hold.</>, confirmLabel: 'Reject slip', danger: true })) return
    try {
      if (kind === 'verify') await api.post(`/finance/slips/${sel.id}/verify`)
      else await api.post(`/finance/slips/${sel.id}/reject`, { reason })
      setMsg({ ok: true, text: kind === 'verify' ? `Marked ${sel.invoices.map((i) => i.inv_number).join(', ')} as Paid.` : 'Slip rejected — the customer has been notified.' })
      load(); window.dispatchEvent(new Event('notifications:refresh'))
    } catch (e) { setMsg({ ok: false, text: e.message }) }
  }
  const amountOf = (s) => (s.invoices.length ? s.invoices_total : s.order_total)
  const Viewer = ({ p }) => !p ? <div className="viewer empty">Loading…</div>
    : p.type === 'application/pdf' ? <iframe title="document" src={p.url} className="viewer" /> : <img src={p.url} alt="Payment slip" className="viewer" />
  const needsInvoice = sel && !sel.invoices.length

  return (
    <div>
      <div className="page-header"><h1>Payment Verification</h1></div>
      <div className="toolbar">
        <div className="chips inline">{['Pending', 'Verified', 'Rejected', 'All'].map((t) => <button key={t} className={`chip ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{t === 'Pending' ? 'To check' : t}</button>)}</div>
        <CustomerFilter value={customer} onChange={setCustomer} />
      </div>
      <Flash msg={msg} />
      <div className="verify-layout">
        <div className="card flush">
          {shown.length === 0 && <div className="empty"><Icon name="CircleCheck" size={24} className="empty-icon" />{tab === 'Pending' ? 'No slips to check.' : 'No slips here.'}</div>}
          {shown.map((s) => (
            <button key={s.id} className={`notif-row ${sel?.id === s.id ? 'selected' : ''}`} onClick={() => setSel(s)}>
              <span className="notif-main">
                <span className="notif-title">{s.customer_name}{showOutlet && <OutletTag code={s.outlet_code} />}</span>
                <span className="muted small">{s.invoices.length ? s.invoices.map((i) => i.inv_number).join(', ') : `${s.so_number} · not invoiced yet`}</span>
              </span>
              <span className="notif-meta"><strong>{money(amountOf(s))}</strong><span className="muted small">{fmtDateTime(s.created_at)}</span></span>
            </button>
          ))}
        </div>
        {sel && (
          <div className="card">
            <div className="card-head">
              <h2>{sel.customer_name} <StatusBadge status={sel.status} label={sel.status === 'Pending' ? 'To check' : undefined} /></h2>
              <FileLink url={`/files/${sel.file_id}`}>Open slip in new tab</FileLink>
            </div>
            {needsInvoice && sel.status === 'Pending' && (
              <div className={`next-step ${sel.order_status === 'Cancelled' ? 'tone-gray' : 'tone-blue'}`}>
                <div className="next-label"><Icon name="Hand" size={16} /> Your next step</div>
                <div className="next-title">{sel.order_status === 'Cancelled' ? `${sel.so_number} was cancelled — reject this slip and arrange a refund` : `Issue the invoice for ${sel.so_number} first`}</div>
                <div className="next-text">This COD slip came with the order ({money(sel.order_total)}). Once the invoice is issued, the slip is attached to it and you can mark it paid here.</div>
                {sel.order_status !== 'Cancelled' && <div className="next-actions"><Link className="btn primary" to={`/finance/invoices/new/${sel.so_id}`}><Icon name="FileText" size={18} /> Issue invoice for {sel.so_number}</Link></div>}
              </div>
            )}
            <div className="side-by-side">
              <div><div className="label">Payment slip · uploaded {fmtDateTime(sel.created_at)}</div><Viewer p={preview} /></div>
              <div><div className="label">{sel.invoices[0] ? `Invoice ${sel.invoices[0].inv_number}` : 'Invoice'}</div>
                {sel.invoices[0] ? <Viewer p={invPreview} /> : <div className="viewer empty">Not invoiced yet</div>}</div>
            </div>
            {sel.invoices.length > 0 && (
              <table>
                <thead><tr><th>Invoice</th><th>Order</th><th>Due</th><th>Status</th><th className="num">Amount</th></tr></thead>
                <tbody>{sel.invoices.map((i) => <tr key={i.id}><td className="mono">{i.inv_number}</td><td>{i.so_number}</td><td>{fmtDay(i.due_date)}</td><td><StatusBadge status={i.payment_status} /></td><td className="num">{money(i.total)}</td></tr>)}</tbody>
                <tfoot><tr><td colSpan="4"><strong>Invoices total</strong>{sel.amount != null && <span className="muted small"> · slip amount {money(sel.amount)}{sel.reference ? ` · ref ${sel.reference}` : ''}</span>}</td><td className="num"><strong>{money(sel.invoices_total)}</strong></td></tr></tfoot>
              </table>
            )}
            {sel.status === 'Pending' ? (
              <div className="verify-actions">
                <input placeholder="Reason (required to reject) — e.g. amount does not match" value={reason} onChange={(e) => setReason(e.target.value)} />
                <button className="btn danger" disabled={!reason.trim()} onClick={() => act('reject')}>Reject</button>
                <button className="btn primary" disabled={needsInvoice} title={needsInvoice ? 'Issue the invoice first' : ''} onClick={() => act('verify')}><Icon name="CircleCheck" size={18} /> Mark as Paid</button>
              </div>
            ) : <p className="small muted">{sel.status} by {sel.reviewed_by_name} on {fmtDateTime(sel.reviewed_at)}{sel.reject_reason ? ` — ${sel.reject_reason}` : ''}</p>}
          </div>
        )}
      </div>
    </div>
  )
}
