import { useEffect, useState } from 'react'
import { api, fmtDateTime } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import Icon from '../../components/Icon.jsx'

const TEMPLATE_LABEL = {
  quantity_adjusted: 'Quantity adjusted', order_confirmed: 'Order confirmed', invoice_issued: 'Invoice issued',
  payment_verified: 'Payment verified', payment_rejected: 'Payment rejected', delivery_link: 'Delivery link', term_result: 'Credit term result',
}

// Every email the system sends (or would send, in development). Settings live in .env.
export default function EmailOutbox() {
  const [rows, setRows] = useState([])
  const [sel, setSel] = useState(null)
  const [filter, setFilter] = useState('')
  useEffect(() => { api.get('/admin/emails').then((r) => { setRows(r); if (r[0]) open(r[0].id) }) }, [])
  const open = (id) => api.get(`/admin/emails/${id}`).then(setSel)
  const shown = rows.filter((r) => !filter || r.template === filter)

  return (
    <div>
      <div className="page-header"><h1>Email Outbox</h1></div>
      <p className="muted">In development (<code>EMAIL_MODE=log</code> in <code>.env</code>) emails are not sent — they are saved here and printed to the server console. Set <code>EMAIL_MODE=smtp</code> and the SMTP settings to send them for real.</p>
      <div className="chips">
        <button className={`chip ${!filter ? 'on' : ''}`} onClick={() => setFilter('')}>All ({rows.length})</button>
        {Object.entries(TEMPLATE_LABEL).map(([k, l]) => <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l} ({rows.filter((r) => r.template === k).length})</button>)}
      </div>
      <div className="outbox">
        <div className="card flush outbox-list">
          {shown.length === 0 && <div className="empty"><Icon name="Inbox" size={24} className="empty-icon" />No emails.</div>}
          {shown.map((r) => (
            <button key={r.id} className={`notif-row ${sel?.id === r.id ? 'selected' : ''}`} onClick={() => open(r.id)}>
              <span className="notif-main">
                <span className="notif-title">{r.subject}</span>
                <span className="muted small">to {r.to_email}</span>
              </span>
              <span className="notif-meta"><StatusBadge status={r.status} /><span className="muted small">{fmtDateTime(r.created_at)}</span></span>
            </button>
          ))}
        </div>
        <div className="card outbox-preview">
          {sel ? <>
            <div className="small muted">To: {sel.to_email} · {TEMPLATE_LABEL[sel.template]} · {fmtDateTime(sel.created_at)}</div>
            <h2>{sel.subject}</h2>
            {sel.error && <div className="alert error">{sel.error}</div>}
            {/* sandboxed: the email HTML can't run scripts or reach this page */}
            <iframe title="Email preview" sandbox="" srcDoc={sel.html} className="email-frame" />
          </> : <p className="muted">Select an email to preview it.</p>}
        </div>
      </div>
    </div>
  )
}
