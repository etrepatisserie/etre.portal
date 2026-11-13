import { useEffect, useState, useCallback } from 'react'
import { api, fmtDay, fmtDate } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'

export default function Account() {
  const [p, setP] = useState(null)
  const [note, setNote] = useState('')
  const [msg, setMsg] = useState(null)
  const load = useCallback(() => api.get('/customer/profile').then(setP), [])
  useEffect(() => { load() }, [load])

  const request = async () => {
    setMsg(null)
    try { await api.post('/customer/term-request', { note }); setMsg({ ok: true, text: 'Request sent to our finance team. You will be notified of the decision.' }); setNote(''); load() }
    catch (e) { setMsg({ ok: false, text: e.message }) }
  }
  if (!p) return <p>Loading…</p>
  const t = p.terms

  return (
    <div>
      <div className="page-header"><h1>Account</h1></div>
      <div className="two-col">
        <div className="card">
          <h2>Company</h2>
          <dl className="kv">
            <dt>Customer</dt><dd><strong>{p.name}</strong> ({p.code})</dd>
            <dt>Contact</dt><dd>{p.contact || '—'}</dd>
            <dt>Email</dt><dd>{p.email || '—'}</dd>
            <dt>Phone</dt><dd>{p.phone || '—'}</dd>
            <dt>Address</dt><dd>{p.address || '—'}</dd>
            <dt>Account since</dt><dd>{fmtDate(p.account_start_date)}</dd>
            <dt>Outlet</dt><dd>{p.outlet_name} — invoices from {p.outlet_company}</dd>
          </dl>
          <p className="muted small">To change these details, please contact us.</p>
        </div>
        <div className="card">
          <h2>Payment term</h2>
          <div className="term-now"><StatusBadge status={t.term} /> {t.term === 'COD' ? 'Pay when you order (attach the slip at checkout)' : `Payment due ${p.term_label} after the invoice date`}</div>
          {msg && <div className={`alert ${msg.ok ? 'success' : 'error'}`}>{msg.text}</div>}
          {t.term === 'COD' && (
            t.pending_request ? (
              <div className="alert info">Your request for a 14-day credit term (sent {fmtDate(t.pending_request.created_at)}) is being reviewed.</div>
            ) : t.can_request ? (
              <div className="form-stack">
                <p>Your account is over 2 months old, so you can request a <strong>14-day credit term</strong>.</p>
                <label>Message to our finance team (optional)<textarea rows="2" value={note} onChange={(e) => setNote(e.target.value)} /></label>
                <button className="btn primary" onClick={request}>Request 14-day Credit Term</button>
              </div>
            ) : (
              <p className="muted">New accounts start on COD. You can request a 14-day credit term from <strong>{fmtDay(t.eligible_from)}</strong> (2 months after your account start date).</p>
            )
          )}
          {t.last_request && t.last_request.status !== 'Pending' && (
            <p className="small muted">Last request: <StatusBadge status={t.last_request.status} /> on {fmtDate(t.last_request.decided_at)}{t.last_request.decision_note ? ` — ${t.last_request.decision_note}` : ''}</p>
          )}
          <p className="small muted">Whatever your term, new orders are paused while any invoice is overdue{t.term === 'COD' ? ' or unpaid' : ''}.</p>
        </div>
      </div>
    </div>
  )
}
