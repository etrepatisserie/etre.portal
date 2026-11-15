import { useCallback, useEffect, useState } from 'react'
import { api, money, fmtDay, fmtDateTime, todayMY } from '../../api.js'
import { useConfirm, useToast } from '../../feedback.js'
import Icon from '../../components/Icon.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import OutletTag, { useShowOutlet } from '../../components/OutletTag.jsx'
import { PageSkeleton } from '../../components/Skeleton.jsx'

// Finance → Blocked Accounts: customers who can't order (unpaid COD / overdue credit-term invoices).
// The block lifts when the payment is verified. An override lets the customer order anyway — reason required,
// until a date (at most 14 days) or for one order — and is recorded in the audit log.
function OverrideForm({ c, maxDays, onDone, onCancel }) {
  const toast = useToast()
  const [today] = useState(todayMY)
  const last = new Date(Date.parse(`${today}T00:00:00Z`) + maxDays * 864e5).toISOString().slice(0, 10)
  const [f, setF] = useState({ reason: '', kind: 'date', expires_on: new Date(Date.parse(`${today}T00:00:00Z`) + 3 * 864e5).toISOString().slice(0, 10) })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('')
    try {
      await api.post(`/finance/customers/${c.id}/override`, { reason: f.reason, single_order: f.kind === 'one', expires_on: f.kind === 'date' ? f.expires_on : undefined })
      toast.success(`${c.name} can order ${f.kind === 'one' ? 'one order' : `until ${fmtDay(f.expires_on)}`}.`); onDone()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  return (
    <form className="override-form" onSubmit={save}>
      <label className="field span-2"><span className="req">Reason</span><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Payment promised by Friday — confirmed by phone" required /></label>
      <fieldset className="field"><legend>Allow orders</legend>
        <label className="check"><input type="radio" name={`k${c.id}`} checked={f.kind === 'date'} onChange={() => setF({ ...f, kind: 'date' })} /><span>Until</span>
          <input type="date" value={f.expires_on} min={today} max={last} disabled={f.kind !== 'date'} onChange={(e) => setF({ ...f, expires_on: e.target.value })} aria-label="Last day" /></label>
        <label className="check"><input type="radio" name={`k${c.id}`} checked={f.kind === 'one'} onChange={() => setF({ ...f, kind: 'one' })} /><span>For one order only</span></label>
      </fieldset>
      {error && <div className="alert error span-2"><Icon name="AlertCircle" size={18} /><span>{error}</span></div>}
      <div className="actions span-2"><button type="button" className="btn secondary" onClick={onCancel}>Cancel</button><button className="btn primary" disabled={busy || !f.reason.trim()}>{busy ? 'Saving…' : 'Grant override'}</button></div>
    </form>
  )
}

export default function BlockedAccounts() {
  const toast = useToast()
  const confirm = useConfirm()
  const showOutlet = useShowOutlet()
  const [d, setD] = useState(null)
  const [open, setOpen] = useState(null)
  const load = useCallback(() => api.get('/finance/blocked').then(setD), [])
  useEffect(() => { load() }, [load])
  const revoke = async (c) => {
    if (!await confirm({ title: `End the override for ${c.name}?`, body: 'They will be blocked from ordering again until the payment is verified.', confirmLabel: 'End override', danger: true })) return
    try { await api.post(`/finance/overrides/${c.override.id}/revoke`); toast.success('Override ended.'); load() } catch (e) { toast.error(e.message) }
  }
  if (!d) return <PageSkeleton cards={0} rows={6} />
  return (
    <div>
      <div className="page-header"><div><h1>Blocked Accounts</h1><div className="muted">Customers who can't order until their payment is verified. Grant an override only when there's a good reason — it's recorded.</div></div></div>
      {d.customers.length === 0 && <div className="card"><p className="empty"><Icon name="CircleCheck" size={24} className="empty-icon" />No blocked accounts.</p></div>}
      {d.customers.map((c) => {
        const owed = c.blocking.reduce((a, i) => a + i.total, 0)
        return (
          <section key={c.id} className={`card blocked-card ${c.override ? 'has-override' : ''}`}>
            <div className="card-head">
              <h2>{c.name} <span className="muted small">{c.code}</span>{showOutlet && <OutletTag code={c.outlet_code} />} <StatusBadge status={c.payment_term} label={c.term_label} /></h2>
              {c.override ? <StatusBadge status="Active" tone="blue" icon="Info" label={c.override.single_order ? 'Override: one order' : `Override until ${fmtDay(c.override.expires_on)}`} />
                : c.blocking.length ? <StatusBadge status="Overdue" label="Blocked from ordering" /> : null}
            </div>
            {c.blocking.length > 0 && <>
              <p className="small muted">Outstanding <strong className="money">{money(owed)}</strong></p>
              <ul className="owed-list small">{c.blocking.map((i) => <li key={i.id}><span className="mono">{i.inv_number}</span> · {money(i.total)} · due {fmtDay(i.due_date)} · <StatusBadge status={i.payment_status} /></li>)}</ul>
            </>}
            {c.override && <p className="small">Granted by {c.override.granted_by_name || '—'} on {fmtDateTime(c.override.granted_at)} — “{c.override.reason}”</p>}
            {open === c.id
              ? <OverrideForm c={c} maxDays={d.max_days} onDone={() => { setOpen(null); load() }} onCancel={() => setOpen(null)} />
              : <div className="actions">
                  {c.override && <button className="btn danger" onClick={() => revoke(c)}>End override</button>}
                  <button className="btn secondary" onClick={() => setOpen(c.id)}><Icon name="Hand" size={18} /> {c.override ? 'Replace override' : 'Grant override'}</button>
                </div>}
            {c.history.length > 0 && <details className="small"><summary>Override history ({c.history.length})</summary><ul>{c.history.map((h) => (
              <li key={h.id}>{fmtDateTime(h.granted_at)} · {h.granted_by_name} · {h.single_order ? `one order${h.used_so_number ? ` (used by ${h.used_so_number})` : ''}` : `until ${fmtDay(h.expires_on)}`} — “{h.reason}”{h.revoked_at ? ` · ended ${fmtDateTime(h.revoked_at)} by ${h.revoked_by_name}` : ''}</li>
            ))}</ul></details>}
          </section>
        )
      })}
    </div>
  )
}
