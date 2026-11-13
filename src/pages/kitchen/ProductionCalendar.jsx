import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtDayLong, fmtDay } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import Icon from '../../components/Icon.jsx'
import { PageSkeleton } from '../../components/Skeleton.jsx'

// Kitchen → Production Calendar: what to make on each day (approved orders only), with highlights,
// and a product × customer table per day. No prices or money anywhere.
const VIEWS = [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'This week'], ['upcoming', 'Upcoming']]
const FLAG = { urgent: ['red', 'AlertTriangle', 'Urgent'], addon: ['navy', 'Plus', 'Add-on'], changed: ['amber', 'Pencil', 'Changed after approval'], shortage_risk: ['amber', 'AlertCircle', 'Possible shortage'] }
const LABEL = { Confirmed: 'New order', Processing: 'In production' }

function Summary({ date }) {
  const [d, setD] = useState(null)
  useEffect(() => { api.get(`/kitchen/summary?date=${date}`).then(setD) }, [date])
  if (!d) return <p className="muted small">Loading…</p>
  if (!d.products.length) return <p className="muted small">Nothing to make.</p>
  return (
    <div className="table-wrap"><table className="no-stack matrix">
      <thead><tr><th>Product</th>{d.customers.map((c) => <th key={c.name} className="num">{c.name}<div className="small">{c.orders.map((o) => <Link key={o.id} to={`/kitchen/orders/${o.id}`} className="mono">{o.so_number}</Link>)}</div></th>)}<th className="num">Total</th></tr></thead>
      <tbody>{d.products.map((p) => (
        <tr key={p.sku}><td><strong>{p.name}</strong><div className="muted small">{p.sku}</div></td>
          {d.customers.map((c) => <td key={c.name} className="num">{p.by_customer[c.name] || <span className="faint">—</span>}</td>)}
          <td className="num"><strong>{p.units}</strong> <span className="muted small">{p.uom}</span></td></tr>
      ))}</tbody>
    </table></div>
  )
}

export default function ProductionCalendar() {
  const [view, setView] = useState('today')
  const [d, setD] = useState(null)
  const [mode, setMode] = useState({}) // date → 'orders' | 'matrix'
  useEffect(() => { api.get(`/kitchen/calendar?view=${view}`).then(setD) }, [view])
  const ready = d?.view === view
  return (
    <div>
      <div className="page-header">
        <div><h1>Production Calendar</h1><div className="muted">Approved orders by production day. Quantities only.</div></div>
        <div className="segmented">{VIEWS.map(([v, l]) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{l}</button>)}</div>
      </div>
      {!ready ? <PageSkeleton cards={0} rows={5} /> : d.days.map((day) => {
        const m = mode[day.date] || 'orders'
        return (
          <section key={day.date} className="card cal-day-card">
            <div className="card-head">
              <h2>{fmtDayLong(day.date)}{day.date === d.today && <span className="tag">Today</span>}</h2>
              <div className="segmented small">
                <button className={m === 'orders' ? 'on' : ''} onClick={() => setMode({ ...mode, [day.date]: 'orders' })}>Orders ({day.orders.length})</button>
                <button className={m === 'matrix' ? 'on' : ''} onClick={() => setMode({ ...mode, [day.date]: 'matrix' })}>By product × customer</button>
              </div>
            </div>
            {day.orders.length === 0 ? <p className="muted small">Nothing to make.</p> : m === 'matrix' ? <Summary date={day.date} /> : <>
              <div className="prod-totals">{day.products.map((p) => <span key={p.sku} className="tag"><strong>{p.qty}</strong> {p.uom} {p.name}</span>)}</div>
              <div className="table-wrap"><table>
                <thead><tr><th>Order</th><th>Customer</th><th>Pickup / delivery</th><th>Items</th><th>Status</th></tr></thead>
                <tbody>{day.orders.map((o) => (
                  <tr key={o.id} className={o.flags.includes('urgent') ? 'tone-red' : o.flags.length ? 'tone-amber' : ''}>
                    <td><Link to={`/kitchen/orders/${o.id}`} className="strong-link">{o.so_number}</Link>
                      <div className="flag-list">{o.flags.map((f) => <StatusBadge key={f} status={f} tone={FLAG[f][0]} icon={FLAG[f][1]} label={f === 'addon' ? `Add-on to ${o.addon_of_number}` : FLAG[f][2]} />)}</div></td>
                    <td>{o.customer_name}</td>
                    <td>{o.method === 'pickup' ? 'Pickup' : 'Delivery'} · {fmtDay(o.fulfil_date)}<div className="muted small">{o.time_slot}</div></td>
                    <td className="small">{o.lines.map((l) => <div key={l.id}>{l.quantity} {l.uom} {l.description}</div>)}</td>
                    <td><StatusBadge status={o.completed_at ? 'Fulfilled' : o.status} label={o.completed_at ? 'Completed' : LABEL[o.status]} /></td>
                  </tr>
                ))}</tbody>
              </table></div>
            </>}
          </section>
        )
      })}
      {ready && <p className="small muted"><Icon name="Info" size={14} /> Highlights: <strong>Urgent</strong> = production is due and not finished · <strong>Add-on</strong> = extra order linked to an earlier one · <strong>Changed after approval</strong> = check the quantities · <strong>Possible shortage</strong> = a product already came out short today.</p>}
    </div>
  )
}
