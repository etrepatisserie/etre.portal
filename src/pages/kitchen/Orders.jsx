import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, fmtDay, fmtDayLong } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import Todo from '../../components/Todo.jsx'
import { toneOf } from '../../status.js'
import Icon from '../../components/Icon.jsx'
import Flash from '../../components/Flash.jsx'

const FILTERS = [['Open', 'To make'], ['New', 'New — not started'], ['Processing', 'In production'], ['', 'All']]
const LABEL = { Confirmed: 'New order', Processing: 'In production' }

export default function KitchenOrders() {
  const [d, setD] = useState(null)
  const [status, setStatus] = useState('Open')
  const [date, setDate] = useState('')
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const navigate = useNavigate()
  const load = useCallback(() => {
    api.get('/kitchen/dashboard').then(setD)
    const p = new URLSearchParams(); if (status) p.set('status', status); if (date) p.set('production_date', date)
    api.get(`/kitchen/orders?${p}`).then(setRows)
  }, [status, date])
  useEffect(() => { load() }, [load])

  const start = async (e, o) => {
    e.stopPropagation(); setBusy(o.id); setMsg(null)
    try { await api.post(`/kitchen/orders/${o.id}/processing`); setMsg({ ok: true, text: `${o.so_number} is now in production.` }); load() }
    catch (err) { setMsg({ ok: false, text: err.message }) } finally { setBusy(null) }
  }
  // the single next action for each order
  const next = (o) => {
    if (o.can_start && !o.printed_at) return <Link className="btn primary" to={`/kitchen/orders/${o.id}?print=1`} onClick={(e) => e.stopPropagation()}><Icon name="Printer" size={18} /> 1. Print sheet</Link>
    if (o.can_start) return <button className="btn primary" disabled={busy === o.id} onClick={(e) => start(e, o)}><Icon name="Play" size={18} /> 2. Start production</button>
    if (o.status === 'Processing' && !o.completed_at) return <Link className="btn secondary" to={`/kitchen/orders/${o.id}`} onClick={(e) => e.stopPropagation()}><Icon name="CircleCheck" size={18} /> 3. Mark completed</Link>
    if (o.status === 'Processing') return <span className="waiting">Completed — Admin to dispatch</span>
    return <span className="waiting">Done</span>
  }

  return (
    <div>
      <div className="page-header"><div><h1>Central Kitchen</h1>{d && <div className="page-date">{fmtDayLong(d.today)}</div>}</div></div>
      {d && <>
        <p className="section-label">Your to-do</p>
        <div className="todo">
          <Todo icon="Printer" n={d.to_print} tone="blue" what="New orders to print" hint="Print the sheet, then start" onClick={() => setStatus('New')} go="Show them" />
          <Todo icon="ChefHat" n={d.produce_today} tone="blue" what={`Units to make today`} hint={fmtDay(d.today)} to="/kitchen/production" go="Production plan" />
          <Todo icon="CalendarDays" n={d.produce_tomorrow} tone="gray" what="Units to make tomorrow" hint="Plan ahead" to="/kitchen/production" go="Production plan" />
          <Todo icon="Play" n={d.to_start} tone="blue" what="Printed, ready to start" hint="Press Start when you begin" onClick={() => setStatus('New')} go="Show them" />
        </div>
      </>}
      <Flash msg={msg} />
      <div className="card">
        <div className="toolbar">
          <div className="chips inline">{FILTERS.map(([v, l]) => <button key={v} className={`chip ${status === v ? 'on' : ''}`} onClick={() => setStatus(v)}>{l}</button>)}</div>
          <label className="inline-field">Production date <input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
          {date && <button className="linkish" onClick={() => setDate('')}>clear</button>}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Customer</th><th>Make on</th><th>Pickup / delivery</th><th className="num">Units</th><th>Status</th><th className="row-action">Next</th></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan="7" className="empty"><Icon name="Inbox" size={24} className="empty-icon" />Nothing here.</td></tr>}
              {rows.map((o) => (
                <tr key={o.id} className={`clickable tone-${toneOf(o.status)}`} onClick={() => navigate(`/kitchen/orders/${o.id}`)}>
                  <td><strong>{o.so_number}</strong>{o.addon_of_number && <div><span className="tag addon-tag">Add-on to {o.addon_of_number}</span></div>}{o.changed_after_approval && <div><span className="tag changed-tag"><Icon name="AlertTriangle" size={12} /> Changed after approval</span></div>}</td><td>{o.customer_name}</td>
                  <td><strong>{fmtDay(o.production_date)}</strong></td>
                  <td>{o.method === 'pickup' ? 'Pickup' : 'Delivery'} · {fmtDay(o.fulfil_date)}<div className="muted small">{o.time_slot}</div></td>
                  <td className="num">{o.lines.reduce((a, l) => a + l.quantity, 0)}</td>
                  <td><StatusBadge status={o.status} label={LABEL[o.status]} /></td>
                  <td className="row-action">{next(o)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
