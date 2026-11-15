import { useEffect, useState, useCallback } from 'react'
import { api, fmtDay } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import OutletField from '../../components/OutletField.jsx'
import OutletTag from '../../components/OutletTag.jsx'
import Icon from '../../components/Icon.jsx'
import { useConfirm, useToast } from '../../feedback.js'

const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const plus = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const TYPES = [['notice', 'Notice'], ['closure', 'Closure / public holiday'], ['price_change', 'Price change']]
const blank = () => ({ outlet_id: '', title: '', body: '', type: 'notice', starts_on: today(), ends_on: plus(today(), 14), closure_from: '', closure_to: '' })

export default function Announcements() {
  const confirm = useConfirm()
  const toast = useToast()
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(null) // null = closed; {id?} = editing
  const [error, setError] = useState('')
  const load = useCallback(() => api.get('/admin/announcements').then(setRows), [])
  useEffect(() => { load() }, [load])
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const save = async (e) => {
    e.preventDefault(); setError('')
    try {
      if (form.id) await api.put(`/admin/announcements/${form.id}`, form); else await api.post('/admin/announcements', form)
      setForm(null); load()
    } catch (err) { setError(err.message) }
  }
  const expire = async (a) => { await api.post(`/admin/announcements/${a.id}/expire`); load() }
  const remove = async (a) => {
    if (!await confirm({ title: `Delete “${a.title}”?`, body: a.type === 'closure' ? 'Its closure dates will no longer be blocked at checkout.' : 'Customers will no longer see it.', confirmLabel: 'Delete', danger: true })) return
    try { await api.del(`/admin/announcements/${a.id}`); load(); toast.success('Announcement deleted.') } catch (e) { toast.error(e.message) }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Announcements</h1>
        {!form && <button className="btn primary" onClick={() => setForm(blank())}><Icon name="Plus" size={18} /> New announcement</button>}
      </div>
      <p className="muted">Shown as a banner at the top of the customer portal between the "show from" and "show until" dates. <strong>Closures</strong> also block those dates for pickup/delivery and are skipped as working days at checkout.</p>

      {form && (
        <form className="card highlight" onSubmit={save}>
          <h2>{form.id ? 'Edit announcement' : 'New announcement'}</h2>
          {error && <div className="alert error">{error}</div>}
          <div className="grid-form">
            <OutletField allowBoth value={form.outlet_id ? String(form.outlet_id) : ''} onChange={(v) => setForm({ ...form, outlet_id: v })} />
            <label>Type<select value={form.type} onChange={set('type')}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
            <label className="span-2">Title *<input value={form.title} onChange={set('title')} required /></label>
            <label className="span-2">Message<textarea rows="2" value={form.body} onChange={set('body')} /></label>
            <label>Show from *<input type="date" value={form.starts_on} onChange={set('starts_on')} required /></label>
            <label>Show until *<input type="date" value={form.ends_on} onChange={set('ends_on')} required /></label>
            {form.type === 'closure' && <>
              <label>Closed from *<input type="date" value={form.closure_from || ''} onChange={set('closure_from')} required /></label>
              <label>Closed until<input type="date" value={form.closure_to || ''} onChange={set('closure_to')} /></label>
            </>}
          </div>
          <div className="actions"><button type="button" className="btn ghost" onClick={() => setForm(null)}>Cancel</button><button className="btn primary">Save</button></div>
        </form>
      )}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Title</th><th>Outlet</th><th>Type</th><th>Shown</th><th>Closed dates</th><th>State</th><th></th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan="7" className="empty"><Icon name="Inbox" size={24} className="empty-icon" />No announcements yet.</td></tr>}
              {rows.map((a) => (
                <tr key={a.id}>
                  <td><strong>{a.title}</strong><div className="muted small">{a.body}</div></td>
                  <td>{a.outlet_code ? <OutletTag code={a.outlet_code} /> : <span className="muted small">Both</span>}</td>
                  <td>{TYPES.find((t) => t[0] === a.type)?.[1]}</td>
                  <td className="small">{fmtDay(a.starts_on)} – {fmtDay(a.ends_on)}</td>
                  <td className="small">{a.closure_from ? `${fmtDay(a.closure_from)}${a.closure_to !== a.closure_from ? ` – ${fmtDay(a.closure_to)}` : ''}` : '—'}</td>
                  <td><StatusBadge status={a.state} /></td>
                  <td className="row-actions">
                    <button className="linkish" onClick={() => setForm({ ...a, closure_from: a.closure_from || '', closure_to: a.closure_to || '' })}>Edit</button>
                    {a.state !== 'Expired' && <button className="linkish" onClick={() => expire(a)}>Expire</button>}
                    <button className="linkish" onClick={() => remove(a)}>Delete</button>
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
