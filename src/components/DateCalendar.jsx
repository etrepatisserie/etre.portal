import { useState } from 'react'
import Icon from './Icon.jsx'

// Month calendar for picking a pickup / delivery date. Only the dates in `dates` can be chosen;
// `closed` dates (outlet closures) are marked, everything else is greyed out.
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
const monthOf = (d) => d.slice(0, 7)
const monthName = (ym) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
const longDay = (d) => new Date(`${d}T00:00:00`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

export default function DateCalendar({ dates, value, onChange, closed = [], reasons = {} }) {
  const months = [...new Set(dates.map(monthOf))].sort()
  const [shown, setShown] = useState(() => monthOf(value || dates[0] || ''))
  const [today] = useState(() => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)) // Malaysia date
  if (!dates.length) return <div className="alert info small">No dates available right now. Please contact us.</div>
  const month = months.includes(shown) ? shown : months[0] || shown
  const at = months.indexOf(month)
  const [y, m] = month.split('-').map(Number)
  const first = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7 // Monday = 0
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const ok = new Set(dates), shut = new Set(closed)
  const cells = [...Array(first).fill(null), ...Array.from({ length: count }, (_, i) => iso(y, m - 1, i + 1))]

  return (
    <div className="cal" role="group" aria-label="Choose a date">
      <div className="cal-head">
        <button type="button" className="cal-nav" disabled={at <= 0} onClick={() => setShown(months[at - 1])} aria-label="Previous month" title="Previous month"><Icon name="ChevronLeft" size={18} /></button>
        <strong><Icon name="Calendar" size={16} /> {monthName(month)}</strong>
        <button type="button" className="cal-nav" disabled={at < 0 || at >= months.length - 1} onClick={() => setShown(months[at + 1])} aria-label="Next month" title="Next month"><Icon name="ChevronRight" size={18} /></button>
      </div>
      <div className="cal-grid">
        {WEEK.map((w) => <div key={w} className="cal-dow">{w}</div>)}
        {cells.map((d, i) => d == null ? <div key={`b${i}`} /> : (
          <button key={d} type="button" disabled={!ok.has(d)} onClick={() => onChange(d)}
            className={`cal-day ${d === value ? 'on' : ''} ${ok.has(d) ? 'open' : ''} ${shut.has(d) ? 'shut' : ''} ${d === today ? 'today' : ''}`}
            aria-pressed={d === value} aria-label={`${longDay(d)}${ok.has(d) ? '' : shut.has(d) ? ` — closed${reasons[d] ? `: ${reasons[d]}` : ''}` : ' — not available'}`}
            title={shut.has(d) ? `Closed${reasons[d] ? `: ${reasons[d]}` : ''}` : undefined}>
            {Number(d.slice(8))}
          </button>
        ))}
      </div>
      <div className="cal-foot small muted">
        <span>{value ? <>Selected: <strong className="cal-picked">{longDay(value)}</strong></> : 'Pick a date'}</span>
        <span className="cal-key"><i className="k-open" /> available{closed.length > 0 && <><i className="k-shut" /> closed</>}</span>
      </div>
    </div>
  )
}
