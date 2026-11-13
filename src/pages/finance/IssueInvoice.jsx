import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, upload, money, fmtDay } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import NextStep from '../../components/NextStep.jsx'
import Totals from '../../components/Totals.jsx'
import FileLink from '../../components/FileLink.jsx'
import Icon from '../../components/Icon.jsx'

// Issue INV-YYYY-#### for a confirmed order: generate the PDFs, or upload your own soft copies
export default function IssueInvoice() {
  const { id } = useParams()
  const [so, setSo] = useState(null)
  const [mode, setMode] = useState('generate')
  const [invFile, setInvFile] = useState(null)
  const [doFile, setDoFile] = useState(null)
  const [meta, setMeta] = useState({ external_number: '', invoice_date: '', due_date: '', amount: '' }) // details printed on an uploaded invoice
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)
  const [busy, setBusy] = useState(false)
  // the company's default invoice method picks the starting option; Finance can still switch
  const load = () => api.get(`/finance/orders/${id}`).then((o) => { setSo(o); setMode((m) => (m === 'generate' && o.invoice_method === 'uploaded' ? 'upload' : m)) }).catch((e) => setError(e.message))
  useEffect(() => { load() }, [id])

  const issue = async () => {
    setError(''); setBusy(true)
    try {
      const fd = new FormData()
      fd.append('mode', mode)
      if (mode === 'upload') {
        if (invFile) fd.append('invoice_file', invFile); if (doFile) fd.append('do_file', doFile)
        for (const [k, v] of Object.entries(meta)) if (v !== '') fd.append(k, v)
      }
      setDone(await upload(`/finance/orders/${id}/invoice`, fd)); load()
      window.dispatchEvent(new Event('notifications:refresh'))
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  if (!so) return error ? <div className="alert error">{error}</div> : <p>Loading…</p>
  const invoice = done || so.invoice
  const days = { NET14: 14, NET15: 15, NET30: 30 }[so.payment_term]
  const due = days ? `${days} days from today` : 'today (COD)'

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="breadcrumb"><Link to="/finance/invoices/new">Orders to Invoice</Link> / {so.so_number}</div>
          <h1>{so.so_number} <StatusBadge status={so.status} /></h1>
          <div className="muted">{so.customer_name} · <StatusBadge status={so.payment_term} /> · {so.method === 'pickup' ? 'Pickup' : 'Delivery'} {fmtDay(so.fulfil_date)}</div>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}

      {invoice ? (
        <NextStep status="Paid" kind="done" title={`Invoice ${invoice.inv_number} issued`}
          actions={<>
            <FileLink className="btn secondary" url={`/documents/invoices/${invoice.id}/invoice`}>View invoice</FileLink>
            <FileLink className="btn secondary" url={`/documents/invoices/${invoice.id}/do`}>View delivery order</FileLink>
            {so.order_slip?.status === 'Pending' && <Link to="/finance/payments" className="btn primary">Verify the COD slip →</Link>}
            <Link to="/finance/invoices/new" className={`btn ${so.order_slip?.status === 'Pending' ? 'ghost' : 'primary'}`}>Next order →</Link>
          </>}>
          {done ? 'The customer has been emailed.' : `Delivery order ${invoice.do_number}.`}{invoice.external_number ? ` Uploaded invoice no. ${invoice.external_number}.` : ''}{done?.amount_mismatch ? ' Note: the uploaded amount differs from the order total.' : ''}
        </NextStep>
      ) : !['Cancelled', 'Pending'].includes(so.status) ? (
        <NextStep status="Confirmed" title={`Issue the invoice — ${money(so.total)}, due ${due}`}
          actions={<button className="btn primary" disabled={busy || (mode === 'upload' && (!invFile || !meta.external_number.trim()))} onClick={issue}>{busy ? 'Issuing…' : <><Icon name="FileText" size={18} /> Issue invoice & email customer</>}</button>}>
          {so.order_slip && <p><Icon name="Upload" size={16} /> The customer attached a <strong>COD payment slip</strong> ({money(so.order_slip.amount)}) — <FileLink url={`/files/${so.order_slip.file_id}`}>view</FileLink>. It will be attached to this invoice for you to verify.</p>}
          <div className="segmented" style={{ margin: '.4rem 0' }}>
            <button className={mode === 'generate' ? 'on' : ''} onClick={() => setMode('generate')}>Generate PDF</button>
            <button className={mode === 'upload' ? 'on' : ''} onClick={() => setMode('upload')}>Upload my own file</button>
          </div>
          {mode === 'generate'
            ? <p>The system creates the tax invoice and delivery order with bank details and SST. Numbers are assigned automatically.</p>
            : <div className="form-stack">
              <label><span className="req">Invoice file</span> (PDF or image, max 10 MB)<input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setInvFile(e.target.files[0] || null)} /></label>
              <div className="settings-grid">
                <label className="field"><span className="req">Invoice number on the file</span><input value={meta.external_number} onChange={(e) => setMeta({ ...meta, external_number: e.target.value })} placeholder="e.g. IV-00451" /></label>
                <label className="field">Invoice date<input type="date" value={meta.invoice_date} onChange={(e) => setMeta({ ...meta, invoice_date: e.target.value })} /><span className="field-help">Empty = today</span></label>
                <label className="field">Due date<input type="date" value={meta.due_date} min={meta.invoice_date || undefined} onChange={(e) => setMeta({ ...meta, due_date: e.target.value })} /><span className="field-help">Empty = from the payment term</span></label>
                <label className="field">Amount on the invoice (RM)<input type="number" step="0.01" min="0" value={meta.amount} onChange={(e) => setMeta({ ...meta, amount: e.target.value })} placeholder={so.total.toFixed(2)} /></label>
              </div>
              {meta.amount !== '' && Math.abs(Number(meta.amount) - so.total) > 0.005 && <div className="alert warn"><Icon name="AlertTriangle" size={18} /><span>The invoice amount {money(Number(meta.amount))} doesn't match the order total {money(so.total)}. Check it before issuing — the order total is what the customer owes.</span></div>}
              <label>Delivery order file (optional — generated if left empty)<input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setDoFile(e.target.files[0] || null)} /></label>
            </div>}
        </NextStep>
      ) : <NextStep status={so.status} kind="done" title={`This order is ${so.status.toLowerCase()} — no invoice needed`} />}

      <div className="card">
        <h2>Order</h2>
        <table>
          <thead><tr><th>Item</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th></tr></thead>
          <tbody>{so.lines.filter((l) => l.quantity > 0).map((l) => (
            <tr key={l.id}><td>{l.description}<div className="muted small">{l.sku}</div></td><td className="num">{l.quantity}</td><td className="num">{money(l.unit_price)}</td><td className="num">{money(l.line_total)}</td></tr>
          ))}</tbody>
        </table>
        <Totals t={so} method={so.method} />
      </div>
    </div>
  )
}
