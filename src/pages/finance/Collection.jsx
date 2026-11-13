import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, money, fmtDay, fmtDateTime, todayMY } from '../../api.js'
import { useToast } from '../../feedback.js'
import Icon from '../../components/Icon.jsx'
import Modal from '../../components/Modal.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import { PageSkeleton } from '../../components/Skeleton.jsx'
import { outletLabel } from '../../outlet.js'

// Finance → Collection: what to chase today, per company (never combined). Shown alongside the Aging report.
// Each customer has follow-up notes (who you spoke to, promised payment date) and their payment history.
const TONE = { due_today: 'amber', due_7: 'blue', over_1_7: 'amber', over_8_14: 'red', over_15: 'red' }

function CustomerPanel({ customerId, name, onClose }) {
  const toast = useToast()
  const [d, setD] = useState(null)
  const [today] = useState(todayMY)
  const [f, setF] = useState({ contact_date: today, contact: '', promised_date: '', remarks: '' })
  const [busy, setBusy] = useState(false)
  const load = useCallback(() => api.get(`/finance/customers/${customerId}/collection`).then(setD), [customerId])
  useEffect(() => { load() }, [load])
  const save = async (e) => {
    e.preventDefault(); setBusy(true)
    try { await api.post(`/finance/customers/${customerId}/notes`, f); toast.success('Follow-up note saved.'); setF({ contact_date: today, contact: '', promised_date: '', remarks: '' }); load() }
    catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={name} icon="Users" onClose={onClose} wide>
      <form className="note-form" onSubmit={save}>
        <h3>Add a follow-up note</h3>
        <div className="settings-grid">
          <label className="field">Date<input type="date" value={f.contact_date} max={today} onChange={(e) => setF({ ...f, contact_date: e.target.value })} /></label>
          <label className="field">Contact made<input value={f.contact} onChange={(e) => setF({ ...f, contact: e.target.value })} placeholder="e.g. Called the owner / WhatsApp" /></label>
          <label className="field">Promised payment date <span className="optional">(optional)</span><input type="date" value={f.promised_date} min={f.contact_date} onChange={(e) => setF({ ...f, promised_date: e.target.value })} /></label>
          <label className="field span-2">Remarks<textarea rows="2" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></label>
        </div>
        <div className="actions"><button className="btn primary" disabled={busy || (!f.contact.trim() && !f.remarks.trim())}>Save note</button></div>
      </form>
      {!d ? <p className="muted">Loading…</p> : <>
        <h3>Follow-up notes</h3>
        {d.notes.length === 0 ? <p className="muted small">No notes yet.</p> : <ul className="audit-trail small">{d.notes.map((n) => <li key={n.id}><strong>{fmtDay(n.contact_date)}</strong> · {n.contact || '—'}{n.promised_date && <> · promised <strong>{fmtDay(n.promised_date)}</strong></>}{n.remarks && <div>{n.remarks}</div>}<div className="muted">{n.user_name} · {fmtDateTime(n.created_at)}</div></li>)}</ul>}
        <h3>Payment history</h3>
        {d.payments.length === 0 ? <p className="muted small">No payment slips yet.</p> : (
          <div className="table-wrap"><table>
            <thead><tr><th>Uploaded</th><th>Invoices</th><th>Status</th><th className="num">Received</th><th>Paid on</th></tr></thead>
            <tbody>{d.payments.map((p) => <tr key={p.id}><td>{fmtDateTime(p.created_at)}</td><td className="mono small">{p.invoices || '—'}</td>
              <td><StatusBadge status={p.status} />{p.reject_reason && <div className="small muted">{p.reject_reason}</div>}</td>
              <td className="num">{p.amount_received != null ? money(p.amount_received) : p.amount != null ? <span className="muted">{money(p.amount)} (slip)</span> : '—'}</td><td>{p.payment_date ? fmtDay(p.payment_date) : '—'}</td></tr>)}</tbody>
          </table></div>
        )}
      </>}
    </Modal>
  )
}

export default function Collection() {
  const [d, setD] = useState(null)
  const [open, setOpen] = useState(null)
  useEffect(() => { api.get('/finance/collection').then(setD) }, [])
  if (!d) return <PageSkeleton cards={5} />
  const single = d.companies.length === 1
  return (
    <div>
      <div className="page-header"><div><h1>Collection{single ? ` — ${outletLabel(d.companies[0].code)}` : ''}</h1><div className="muted">Invoices to chase, by how late they are. Amounts are what's still owed after credit notes. See also the <Link to="/finance/aging">Aging report</Link>.</div></div></div>
      {d.companies.map((c) => (
        <section key={c.code} className="stats-company">
          {!single && <h2 className="company-title"><span className={`outlet-tag outlet-${c.code.toLowerCase()}`}>{outletLabel(c.code)}</span> {c.company_name}</h2>}
          <div className="kpis">{c.buckets.map((b) => (
            <div key={b.key} className={`stat tone-${TONE[b.key]}`}><div className="stat-label">{b.label}</div><div className="stat-value">{money(b.total)}</div><div className="stat-sub">{b.count} invoice{b.count === 1 ? '' : 's'}</div></div>
          ))}</div>
          {c.buckets.filter((b) => b.count).map((b) => (
            <div key={b.key} className="card flush">
              <div className="card-head card-pad"><h2>{b.label}</h2><span className="muted small">{money(b.total)}</span></div>
              <div className="table-wrap"><table>
                <thead><tr><th>Customer</th><th>Invoice</th><th>Due</th><th>Payment</th><th className="num">Owed</th><th>Last follow-up</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>{b.invoices.map((i) => (
                  <tr key={i.id} className={`tone-${TONE[b.key]}`}>
                    <td><strong>{i.customer_name}</strong><div className="muted small">{i.customer_code}{i.customer_phone ? ` · ${i.customer_phone}` : ''}</div></td>
                    <td className="mono">{i.inv_number}</td>
                    <td>{fmtDay(i.due_date)}{i.days_late > 0 && <div className="small neg">{i.days_late} day{i.days_late === 1 ? '' : 's'} late</div>}</td>
                    <td><StatusBadge status={i.payment_status} /></td>
                    <td className="num">{money(i.balance)}</td>
                    <td className="small">{i.last_note || <span className="muted">—</span>}</td>
                    <td className="row-action"><button className="btn secondary small" onClick={() => setOpen({ id: i.customer_id, name: i.customer_name })}><Icon name="Pencil" size={16} /> Notes</button></td>
                  </tr>
                ))}</tbody>
              </table></div>
            </div>
          ))}
          {c.buckets.every((b) => !b.count) && <div className="card"><p className="empty"><Icon name="CircleCheck" size={24} className="empty-icon" />Nothing due in the next 7 days and nothing overdue.</p></div>}
        </section>
      ))}
      {open && <CustomerPanel customerId={open.id} name={open.name} onClose={() => setOpen(null)} />}
    </div>
  )
}
