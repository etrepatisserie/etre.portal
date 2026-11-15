import { useCallback, useEffect, useState } from 'react'
import { api, upload, fmtDateTime, fmtDay } from '../api.js'
import { useToast } from '../feedback.js'
import Modal from './Modal.jsx'
import FileLink from './FileLink.jsx'
import Icon from './Icon.jsx'

// Invoice + DO documents for one invoice: view, upload / replace (with a reason), and the history.
// role 'finance' can replace an uploaded invoice and upload DOs; 'admin' uploads DOs.
export default function DocumentsPanel({ invoice, role, onClose, onChanged }) {
  const toast = useToast()
  const base = role === 'finance' ? `/finance/invoices/${invoice.id}` : `/admin/invoices/${invoice.id}`
  const [hist, setHist] = useState(null)
  const [kind, setKind] = useState('do')
  const [file, setFile] = useState(null)
  const [reason, setReason] = useState('')
  const [doDate, setDoDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(() => api.get(`${base}/documents`).then(setHist).catch((e) => setError(e.message)), [base])
  useEffect(() => { load() }, [load])

  const canInvoice = role === 'finance' && invoice.source === 'uploaded'
  const replacing = kind === 'do' ? invoice.do_source === 'uploaded' : true
  const save = async (e) => {
    e.preventDefault(); setError(''); setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file); if (reason) fd.append('reason', reason); if (doDate) fd.append('do_date', doDate)
      if (role === 'finance') { fd.append('kind', kind); await upload(`${base}/documents`, fd) } else await upload(`${base}/do`, fd)
      toast.success(`${kind === 'do' ? 'Delivery order' : 'Invoice'} ${replacing ? 'replaced' : 'uploaded'}.`)
      setFile(null); setReason(''); load(); onChanged?.()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`Documents · ${invoice.inv_number}`} icon="FileText" onClose={onClose} wide>
      <div className="doc-row"><span><Icon name="FileText" size={16} /> Invoice <strong className="mono">{invoice.inv_number}</strong>{invoice.external_number ? ` · no. ${invoice.external_number}` : ''} <span className="muted small">({invoice.source === 'uploaded' ? 'uploaded' : 'generated'})</span></span>
        <FileLink url={`/documents/invoices/${invoice.id}/invoice`}>View</FileLink></div>
      <div className="doc-row"><span><Icon name="Package" size={16} /> Delivery order <strong className="mono">{invoice.do_number}</strong> <span className="muted small">({invoice.do_source === 'uploaded' ? `uploaded${invoice.do_date ? ` · ${fmtDay(invoice.do_date)}` : ''}` : 'generated'})</span></span>
        <FileLink url={`/documents/invoices/${invoice.id}/do`}>View</FileLink></div>

      <form className="doc-upload" onSubmit={save}>
        <h3>{canInvoice ? 'Upload or replace' : 'Upload the delivery order'}</h3>
        {canInvoice && <div className="segmented small"><button type="button" className={kind === 'do' ? 'on' : ''} onClick={() => setKind('do')}>Delivery order</button><button type="button" className={kind === 'invoice' ? 'on' : ''} onClick={() => setKind('invoice')}>Invoice</button></div>}
        <label className="field"><span className="req">File</span> (PDF or photo, max 10 MB)<input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setFile(e.target.files[0] || null)} /></label>
        {kind === 'do' && <label className="field">DO date<input type="date" value={doDate} onChange={(e) => setDoDate(e.target.value)} /></label>}
        {replacing && <label className="field"><span className="req">Reason for replacing</span><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Signed copy from the customer" /></label>}
        <p className="small muted">One {kind === 'do' ? 'DO' : 'invoice'} per order — a new upload replaces the current file. Every earlier file stays in the history below.</p>
        {error && <div className="alert error"><Icon name="AlertCircle" size={18} /><span>{error}</span></div>}
        <div className="actions"><button className="btn primary" disabled={busy || !file || (replacing && !reason.trim())}><Icon name="Upload" size={18} /> {busy ? 'Uploading…' : replacing ? 'Replace' : 'Upload'}</button></div>
      </form>

      <h3>History</h3>
      {!hist ? <p className="muted small">Loading…</p> : hist.versions.length === 0 && hist.audit.length === 0 ? <p className="muted small">No uploads or changes yet.</p> : (
        <ul className="audit-trail small">
          {hist.versions.map((v) => <li key={`v${v.id}`}>{fmtDateTime(v.created_at)} · {v.kind === 'do' ? 'DO' : 'Invoice'} {v.replaced_file_id ? 'replaced' : 'uploaded'} by {v.user_name}{v.reason ? ` — “${v.reason}”` : ''} · <FileLink url={`/files/${v.file_id}`}>file</FileLink>{v.replaced_file_id && <> · <FileLink url={`/files/${v.replaced_file_id}`}>previous</FileLink></>}</li>)}
          {hist.audit.filter((a) => a.action === 'issued').map((a) => <li key={`a${a.id}`}>{fmtDateTime(a.created_at)} · issued ({a.after?.method}) by {a.user_name}</li>)}
        </ul>
      )}
    </Modal>
  )
}
