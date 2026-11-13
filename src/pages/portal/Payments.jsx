import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api, upload, money, fmtDay, fmtDateTime } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import BankDetails from '../../components/BankDetails.jsx'
import FileLink from '../../components/FileLink.jsx'
import Icon from '../../components/Icon.jsx'

// Pay by bank transfer, then upload the slip and choose which invoice(s) it covers
export default function Payments() {
  const [invoices, setInvoices] = useState([])
  const [slips, setSlips] = useState([])
  const [credits, setCredits] = useState([])
  const [info, setInfo] = useState(null)
  const [selected, setSelected] = useState([])
  const [file, setFile] = useState(null)
  const [reference, setReference] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [fileKey, setFileKey] = useState(0)

  const load = useCallback(() => {
    // preselect every invoice still to pay: one transfer, one slip, one button
    api.get('/customer/invoices').then((rows) => { setInvoices(rows); setSelected(rows.filter((i) => ['Unpaid', 'Rejected'].includes(i.payment_status)).map((i) => i.id)) })
    api.get('/customer/slips').then(setSlips)
    api.get('/customer/credit-notes').then(setCredits)
    api.get('/customer/checkout-info').then(setInfo)
  }, [])
  useEffect(() => { load() }, [load])

  const payable = invoices.filter((i) => ['Unpaid', 'Rejected'].includes(i.payment_status))
  const waiting = invoices.filter((i) => i.payment_status === 'Slip Uploaded')
  const toggle = (id) => setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  const selectedTotal = payable.filter((i) => selected.includes(i.id)).reduce((a, i) => a + i.balance, 0) // after credit notes

  const submit = async (e) => {
    e.preventDefault(); setMsg(null); setBusy(true)
    try {
      const fd = new FormData()
      fd.append('slip', file)
      fd.append('invoice_ids', JSON.stringify(selected))
      fd.append('reference', reference)
      fd.append('amount', String(Math.round(selectedTotal * 100) / 100))
      await upload('/customer/slips', fd)
      setMsg({ ok: true, text: 'Slip uploaded. Our finance team will verify it shortly — you will be notified.' })
      setSelected([]); setFile(null); setReference(''); setFileKey((k) => k + 1); load()
      window.dispatchEvent(new Event('notifications:refresh'))
    } catch (err) { setMsg({ ok: false, text: err.message }) } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="page-header"><h1>Payments</h1></div>
      {info?.blocked && <div className="alert error">New orders are on hold until the invoices marked below are paid and verified.</div>}

      <div className="two-col">
        <form className="card" onSubmit={submit}>
          <h2>Pay {payable.length > 1 ? `${payable.length} invoices` : 'your invoice'}</h2>
          {msg && <div className={`alert ${msg.ok ? 'success' : 'error'}`}>{msg.text}</div>}
          <p className="small"><strong>1.</strong> Transfer the total below to our bank account. <strong>2.</strong> Attach the bank slip and press the button. Untick an invoice if you are not paying it now.</p>
          {payable.length === 0 ? <p className="muted"><Icon name="CircleCheck" size={16} /> You have no invoices waiting for payment.</p> : (
            <div className="pay-list">
              {payable.map((i) => (
                <label key={i.id} className={`pay-row ${selected.includes(i.id) ? 'on' : ''}`}>
                  <input type="checkbox" checked={selected.includes(i.id)} onChange={() => toggle(i.id)} />
                  <span className="mono">{i.inv_number}</span>
                  <span className="muted small">{i.so_number} · due {fmtDay(i.due_date)}{i.payment_status === 'Rejected' ? ' · slip rejected' : ''}{i.credited > 0 ? ` · ${money(i.total)} less ${money(i.credited)} credit` : ''}</span>
                  <strong className="num">{money(i.balance)}</strong>
                </label>
              ))}
            </div>
          )}
          {payable.some((i) => i.payment_status === 'Rejected') && (
            <div className="alert error small">
              {payable.filter((i) => i.payment_status === 'Rejected').map((i) => <div key={i.id}>{i.inv_number}: {i.last_reject_reason}</div>)}
            </div>
          )}
          {selected.length > 0 && <div className="pay-total">Selected: <strong>{money(selectedTotal)}</strong> ({selected.length} invoice{selected.length > 1 ? 's' : ''})</div>}
          <label className="field">Payment slip *
            <input key={fileKey} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files[0] || null)} required />
          </label>
          <label className="field">Bank reference (optional)
            <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. transaction ID" />
          </label>
          <BankDetails bank={info?.bank} reference="your invoice number(s)" />
          <button className="btn primary block" style={{ marginTop: '.8rem' }} disabled={busy || !file || !selected.length}>{busy ? 'Uploading…' : `Pay & upload slip · ${money(selectedTotal)}`}</button>
        </form>

        <div>
          {waiting.length > 0 && (
            <div className="card">
              <h2>Waiting for verification</h2>
              {waiting.map((i) => <div key={i.id} className="doc-row"><span className="mono">{i.inv_number}</span><span>{money(i.balance)} <StatusBadge status="Slip Uploaded" /></span></div>)}
              <p className="muted small">These still count as unpaid until our finance team verifies the slip.</p>
            </div>
          )}
          {credits.length > 0 && (
            <div className="card">
              <h2>Credit notes</h2>
              {credits.slice(0, 12).map((c) => (
                <div key={c.id} className="doc-row">
                  <span>
                    <FileLink download url={`/documents/credit-notes/${c.id}`} filename={`${c.cn_number}.pdf`}>{c.cn_number}</FileLink>
                    <div className="small muted">{fmtDay(c.issue_date)} · for {c.inv_number} · {c.reason}</div>
                    <div className="small">{c.settlement === 'Reduces amount due' ? 'Deducted from the amount due' : 'Invoice already paid — we will refund or offset it'}</div>
                  </span>
                  <strong className="num">− {money(c.total)}</strong>
                </div>
              ))}
            </div>
          )}
          <div className="card">
            <h2>Uploaded slips</h2>
            {slips.length === 0 && <p className="muted">No slips uploaded yet.</p>}
            {slips.slice(0, 12).map((s) => (
              <div key={s.id} className="doc-row">
                <span>
                  <FileLink url={`/files/${s.file_id}`}>{fmtDateTime(s.created_at)}</FileLink>
                  <div className="small muted">{s.invoices.map((i) => i.inv_number).join(', ')}{s.amount ? ` · ${money(s.amount)}` : ''}</div>
                  {s.reject_reason && <div className="small neg">{s.reject_reason}</div>}
                </span>
                <StatusBadge status={s.status} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <h2>All invoices</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Invoice</th><th>Order</th><th>Issued</th><th>Due</th><th>Status</th><th className="num">Amount</th><th>Documents</th></tr></thead>
            <tbody>
              {invoices.length === 0 && <tr><td colSpan="7" className="empty"><Icon name="Inbox" size={24} className="empty-icon" />No invoices yet.</td></tr>}
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td className="mono">{i.inv_number}</td><td><Link to={`/portal/orders/${i.so_id}`}>{i.so_number}</Link></td>
                  <td>{fmtDay(i.issue_date)}</td><td>{fmtDay(i.due_date)}</td><td><StatusBadge status={i.payment_status} /></td>
                  <td className="num">{money(i.total)}{i.credited > 0 && <div className="small muted">− {money(i.credited)} credit</div>}</td>
                  <td className="row-actions">
                    <FileLink download url={`/documents/invoices/${i.id}/invoice`} filename={`${i.inv_number}.pdf`}>Invoice</FileLink>
                    <FileLink download url={`/documents/invoices/${i.id}/do`} filename={`${i.do_number}.pdf`}>DO</FileLink>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
