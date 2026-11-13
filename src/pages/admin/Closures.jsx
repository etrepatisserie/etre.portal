import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtDay, fmtDateTime } from '../../api.js'
import { useConfirm, useToast } from '../../feedback.js'
import Icon from '../../components/Icon.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import OutletTag, { useShowOutlet } from '../../components/OutletTag.jsx'
import { PageSkeleton } from '../../components/Skeleton.jsx'
import { orderStatus } from '../../status.js'
import { useAuth } from '../../auth.jsx'

// Admin → Closures: days an outlet is closed and what that blocks. Customers see each closure as a notice and
// can't pick the blocked dates at checkout. Adding a closure never moves existing orders — they are flagged below.
const BLOCK_LABEL = { production: 'Production (no pickup / delivery the day after)', delivery: 'Delivery', collection: 'Collection (pickup)' }
const blank = () => ({ title: '', reason: '', outlet_id: '', closure_from: '', closure_to: '', blocks: ['production', 'delivery', 'collection'], repeat_yearly: false })

export default function Closures() {
  const { user } = useAuth()
  const toast = useToast()
  const confirm = useConfirm()
  const showOutlet = useShowOutlet()
  const [d, setD] = useState(null)
  const [outlets, setOutlets] = useState([])
  const [form, setForm] = useState(null)       // null = closed; {…} = new or edit (id)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const load = useCallback(() => api.get('/admin/closures').then(setD), [])
  useEffect(() => { load(); api.get('/outlets').then(setOutlets).catch(() => {}) }, [load])

  const save = async (e) => {
    e.preventDefault(); setError(''); setBusy(true)
    try {
      const body = { ...form, outlet_id: form.outlet_id || null, closure_to: form.closure_to || form.closure_from }
      const r = form.id ? await api.put(`/admin/closures/${form.id}`, body) : await api.post('/admin/closures', body)
      toast.success(`Closure saved.${r.affected?.length ? ` ${r.affected.length} order(s) now fall on a closed date — see below.` : ''}`)
      setForm(null); load()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }
  const remove = async (c) => {
    if (!await confirm({ title: `Delete "${c.title}"?`, body: 'Its dates become available again at checkout and the notice disappears.', confirmLabel: 'Delete closure', danger: true })) return
    try { await api.del(`/admin/closures/${c.id}`); toast.success('Closure deleted.'); load() } catch (err) { toast.error(err.message) }
  }
  const toggle = (b) => setForm({ ...form, blocks: form.blocks.includes(b) ? form.blocks.filter((x) => x !== b) : [...form.blocks, b] })

  if (!d) return <PageSkeleton cards={0} rows={6} />
  const upcoming = d.closures.filter((c) => c.repeat_yearly || (c.closure_to || c.closure_from) >= d.today)
  const past = d.closures.filter((c) => !upcoming.includes(c))
  const row = (c) => (
    <tr key={c.id}>
      <td><strong>{c.title}</strong>{showOutlet && c.outlet_code && <OutletTag code={c.outlet_code} />}{!c.outlet_id && <span className="tag">Both outlets</span>}{c.reason && <div className="muted small">{c.reason}</div>}</td>
      <td>{fmtDay(c.closure_from)}{c.closure_to && c.closure_to !== c.closure_from ? ` – ${fmtDay(c.closure_to)}` : ''}{c.repeat_yearly ? <div className="small"><Icon name="RefreshCcw" size={14} /> every year</div> : null}</td>
      <td>{c.blocks.map((b) => <span key={b} className="tag">{b === 'collection' ? 'collection' : b}</span>)}</td>
      <td className="muted small">{c.created_by_name || '—'}<div>{fmtDateTime(c.created_at)}</div></td>
      <td className="row-action">{(!user.outlet_id || c.outlet_id === user.outlet_id) && <span className="row-buttons">
        <button className="btn secondary small" onClick={() => setForm({ ...c, outlet_id: c.outlet_id || '', repeat_yearly: !!c.repeat_yearly })}><Icon name="Pencil" size={16} /> Edit</button>
        <button className="btn ghost small" onClick={() => remove(c)} aria-label={`Delete ${c.title}`} title="Delete"><Icon name="Trash2" size={16} /></button></span>}</td>
    </tr>
  )

  return (
    <div>
      <div className="page-header">
        <div><h1>Closures</h1><div className="muted">Public holidays and special closures. Customers see them as a notice and can't choose blocked dates.</div></div>
        {!form && <button className="btn primary" onClick={() => setForm(blank())}><Icon name="Plus" size={18} /> New closure</button>}
      </div>

      {d.affected.length > 0 && (
        <section className="next-step tone-red">
          <div className="next-label"><Icon name="AlertTriangle" size={16} /> Needs review</div>
          <div className="next-title">{d.affected.length} open order{d.affected.length === 1 ? '' : 's'} fall{d.affected.length === 1 ? 's' : ''} on a closed date</div>
          <div className="next-text">These were not moved automatically. Open each order to agree a new date with the customer, or cancel it.</div>
          <div className="table-wrap" style={{ marginTop: 12 }}><table>
            <thead><tr><th>Order</th><th>Customer</th><th>Pickup / delivery</th><th>Status</th><th>Why</th></tr></thead>
            <tbody>{d.affected.map((o) => (
              <tr key={o.id}><td><Link to={`/admin/sales/${o.id}`} className="strong-link">{o.so_number}</Link>{showOutlet && <OutletTag code={o.outlet_code} />}</td><td>{o.customer_name}</td>
                <td>{o.method === 'pickup' ? 'Pickup' : 'Delivery'} · {fmtDay(o.fulfil_date)}</td><td><StatusBadge status={orderStatus(o)} /></td><td className="small neg">{o.reason}</td></tr>
            ))}</tbody>
          </table></div>
        </section>
      )}

      {form && (
        <form className="card settings-section" onSubmit={save}>
          <div className="settings-head"><h2><Icon name="CalendarDays" size={18} /> {form.id ? 'Edit closure' : 'New closure'}</h2><p className="muted small">Existing orders are never moved — any that fall on these dates are flagged for you.</p></div>
          <div className="settings-grid">
            <label className="field"><span className="req">Name</span><input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="e.g. Hari Raya Aidilfitri" required /></label>
            <label className="field">Reason <span className="optional">(shown to customers)</span><input value={form.reason || ''} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Public holiday" /></label>
            {!user.outlet_id && <label className="field">Outlet<select value={form.outlet_id} onChange={(e) => setForm({ ...form, outlet_id: e.target.value })}>
              <option value="">Both outlets</option>{outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
            <label className="field"><span className="req">From</span><input type="date" value={form.closure_from} onChange={(e) => setForm({ ...form, closure_from: e.target.value })} required /></label>
            <label className="field">To <span className="optional">(same day if empty)</span><input type="date" value={form.closure_to || ''} min={form.closure_from} onChange={(e) => setForm({ ...form, closure_to: e.target.value })} /></label>
            <fieldset className="field span-2 block-set"><legend className="req">What it blocks</legend>
              {Object.entries(BLOCK_LABEL).map(([k, l]) => <label key={k} className="check"><input type="checkbox" checked={form.blocks.includes(k)} onChange={() => toggle(k)} /><span>{l}</span></label>)}
            </fieldset>
            <label className="check span-2"><input type="checkbox" checked={form.repeat_yearly} onChange={(e) => setForm({ ...form, repeat_yearly: e.target.checked })} /><span>Repeat every year on the same dates</span></label>
          </div>
          {error && <div className="alert error"><Icon name="AlertCircle" size={18} /><span>{error}</span></div>}
          <div className="actions"><button type="button" className="btn secondary" onClick={() => { setForm(null); setError('') }}>Cancel</button><button className="btn primary" disabled={busy || !form.blocks.length}>{busy ? 'Saving…' : 'Save closure'}</button></div>
        </form>
      )}

      <div className="card flush">
        <div className="card-head card-pad"><h2>Upcoming & yearly</h2></div>
        <div className="table-wrap"><table>
          <thead><tr><th>Closure</th><th>Dates</th><th>Blocks</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>{upcoming.length === 0 ? <tr><td colSpan="5" className="empty"><Icon name="CalendarDays" size={24} className="empty-icon" />No upcoming closures.</td></tr> : upcoming.map(row)}</tbody>
        </table></div>
      </div>
      {past.length > 0 && <details className="card"><summary>Past closures ({past.length})</summary><div className="table-wrap"><table><tbody>{past.map(row)}</tbody></table></div></details>}
    </div>
  )
}
