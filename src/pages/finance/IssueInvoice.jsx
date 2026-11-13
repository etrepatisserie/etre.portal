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
  const [error, setError] = useState('')
  const [done, setDone] = useState(null)
  const [busy, setBusy] = useState(false)
  const load = () => api.get(`/finance/orders/${id}`).then(setSo).catch((e) => setError(e.message))
  useEffect(() => { load() }, [id])

  const issue = async () => {
    setError(''); setBusy(true)
    try {
      const fd = new FormData()
      fd.append('mode', mode)
      if (mode === 'upload') { if (invFile) fd.append('invoice_file', invFile); if (doFile) fd.append('do_file', doFile) }
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
          {done ? 'The customer has been emailed and the kitchen can start production.' : `Delivery order ${invoice.do_number}.`}
        </NextStep>
      ) : !['Cancelled', 'Pending'].includes(so.status) ? (
        <NextStep status="Confirmed" title={`Issue the invoice — ${money(so.total)}, due ${due}`}
          actions={<button className="btn primary" disabled={busy || (mode === 'upload' && !invFile)} onClick={issue}>{busy ? 'Issuing…' : <><Icon name="FileText" size={18} /> Issue invoice & email customer</>}</button>}>
          {so.order_slip && <p><Icon name="Upload" size={16} /> The customer attached a <strong>COD payment slip</strong> ({money(so.order_slip.amount)}) — <FileLink url={`/files/${so.order_slip.file_id}`}>view</FileLink>. It will be attached to this invoice for you to verify.</p>}
          <div className="segmented" style={{ margin: '.4rem 0' }}>
            <button className={mode === 'generate' ? 'on' : ''} onClick={() => setMode('generate')}>Generate PDF</button>
            <button className={mode === 'upload' ? 'on' : ''} onClick={() => setMode('upload')}>Upload my own file</button>
          </div>
          {mode === 'generate'
            ? <p>The system creates the tax invoice and delivery order with bank details and SST. Numbers are assigned automatically.</p>
            : <div className="form-stack">
              <label>Invoice file * (PDF or image, max 10 MB)<input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setInvFile(e.target.files[0] || null)} /></label>
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
