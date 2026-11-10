import { fmtDateTime } from '../api.js'

const STEPS = ['Pending', 'Confirmed', 'Packed', 'Shipped', 'Delivered']
const STEP_LABEL = { Pending: 'Placed', Confirmed: 'Confirmed', Packed: 'Packed', Shipped: 'Shipped', Delivered: 'Delivered' }

// Horizontal progress stepper for a sales order
export function Stepper({ status }) {
  if (status === 'Cancelled') return <div className="stepper cancelled">✕ This order was cancelled</div>
  const idx = STEPS.indexOf(status)
  return (
    <ol className="stepper">
      {STEPS.map((s, i) => (
        <li key={s} className={i < idx ? 'done' : i === idx ? 'current' : ''}>
          <span className="dot">{i <= idx ? '✓' : i + 1}</span>
          <span className="step-label">{STEP_LABEL[s]}</span>
        </li>
      ))}
    </ol>
  )
}

// Vertical event history (newest first)
export function EventList({ events }) {
  return (
    <ul className="events">
      {[...events].reverse().map((e) => (
        <li key={e.id}>
          <div className="event-time">{fmtDateTime(e.created_at)}</div>
          <div><strong>{e.status}</strong> — {e.note}</div>
        </li>
      ))}
    </ul>
  )
}
