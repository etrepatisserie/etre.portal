import { useEffect, useState, useCallback } from 'react'
import { api, money, fmtDate, fmtDay } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import CustomerFilter, { matchesCustomer } from '../../components/CustomerFilter.jsx'
import OutletTag, { useShowOutlet } from '../../components/OutletTag.jsx'
import Icon from '../../components/Icon.jsx'

const TERM_LABEL = { COD: 'COD', NET14: '14 days', NET15: '15 days', NET30: '30 days' }

export default function PaymentTerms() {
  const [customers, setCustomers] = useState([])
  const [requests, setRequests] = useState([])
  const [tab, setTab] = useState('Pending')
  const [notes, setNotes] = useState({})
  const [msg, setMsg] = useState(null)
  const [customer, setCustomer] = useState('')
  const showOutlet = useShowOutlet()
  const load = useCallback(() => {
    api.get('/finance/customers').then(setCustomers)
    api.get(`/finance/term-requests?status=${tab}`).then(setRequests)
  }, [tab])
  useEffect(() => { load() }, [load])

  const decide = async (r, approve) => {
    setMsg(null)
    try { await api.post(`/finance/term-requests/${r.id}/${approve ? 'approve' : 'reject'}`, { note: notes[r.id] || '' }); setMsg({ ok: true, text: `${r.customer_name}: request ${approve ? 'approved — now on 14-day term' : 'rejected'}. Customer emailed.` }); load() }
    catch (e) { setMsg({ ok: false, text: e.message }) }
  }
  const setTerm = async (c, term) => {
    if (term === c.payment_term) return
    if (!confirm(`Change ${c.name} to ${TERM_LABEL[term]}?`)) return
    try { await api.post(`/finance/customers/${c.id}/term`, { term }); load() } catch (e) { setMsg({ ok: false, text: e.message }) }
  }
  const age = (days) => (days >= 60 ? `${Math.floor(days / 30)} months` : `${days} days`)

  return (
    <div>
      <div className="page-header"><h1>Payment Terms</h1></div>
      <div className="toolbar"><CustomerFilter value={customer} onChange={setCustomer} /></div>
      {msg && <div className={`alert ${msg.ok ? 'success' : 'error'}`}>{msg.text}</div>}
      <div className="card">
        <div className="card-head"><h2>Credit term requests</h2>
          <div className="chips inline">{['Pending', 'Approved', 'Rejected', 'All'].map((t) => <button key={t} className={`chip ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{t}</button>)}</div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Customer</th><th>Requested</th><th>Account since</th><th className="num">Orders</th><th className="num">Outstanding</th><th>Message</th><th>Decision</th></tr></thead>
            <tbody>
              {requests.filter((r) => matchesCustomer(r.customer_name, customer)).length === 0 && <tr><td colSpan="7" className="empty"><Icon name="Inbox" size={24} className="empty-icon" />No requests.</td></tr>}
              {requests.filter((r) => matchesCustomer(r.customer_name, customer)).map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.customer_name}</strong><div className="muted small">{r.customer_code}</div></td>
                  <td>{fmtDate(r.created_at)}</td><td>{fmtDate(r.account_start_date)}</td><td className="num">{r.order_count}</td>
                  <td className="num">{r.outstanding > 0 ? money(r.outstanding) : '—'}</td><td className="small">{r.note || '—'}</td>
                  <td>{r.status === 'Pending' ? (
                    <div className="form-stack tight">
                      <input placeholder="Note to customer (optional)" value={notes[r.id] || ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                      <div className="row-gap"><button className="btn primary small" onClick={() => decide(r, true)}>Approve 14 days</button><button className="btn danger small" onClick={() => decide(r, false)}>Reject</button></div>
                    </div>
                  ) : <span className="small"><StatusBadge status={r.status} /> {r.decided_by_name} · {fmtDate(r.decided_at)}{r.decision_note ? <div className="muted">{r.decision_note}</div> : null}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h2>Customers</h2>
        <p className="muted small">New customers start on COD and can request 14 days after 2 months. Pick any term (COD, 14, 15 or 30 days) at any time — it applies to new invoices.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Customer</th><th>Term</th><th>Account age</th><th>Can request from</th><th className="num">Outstanding</th><th className="num">Overdue</th><th>Set term</th></tr></thead>
            <tbody>{customers.filter((c) => matchesCustomer(c.name, customer)).map((c) => (
              <tr key={c.id}>
                <td><strong>{c.name}</strong>{showOutlet && <OutletTag code={c.outlet_code} />}<div className="muted small">{c.code}{c.pending_request ? ' · request pending' : ''}</div></td>
                <td><StatusBadge status={c.payment_term} /></td><td>{age(c.account_age_days)}</td><td className="small">{fmtDay(c.eligible_from)}</td>
                <td className="num">{c.outstanding > 0 ? money(c.outstanding) : '—'}</td>
                <td className={`num ${c.overdue > 0 ? 'neg' : ''}`}>{c.overdue > 0 ? money(c.overdue) : '—'}</td>
                <td><select value={c.payment_term} onChange={(e) => setTerm(c, e.target.value)} aria-label={`Term for ${c.name}`} style={{ width: 'auto' }}>
                  {Object.entries(TERM_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
