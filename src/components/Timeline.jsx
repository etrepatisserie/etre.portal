import { fmtDateTime } from '../api.js'
import { toneOf } from '../status.js'
import { STATUS_ICON } from '../icons.js'
import Icon from './Icon.jsx'

const STEPS = (method, audience) => {
  const c = audience === 'customer'
  return [
    ['Pending', c ? 'Order placed' : 'Approval', c ? 'our team approves it' : 'Admin to approve'],
    ['Confirmed', c ? 'Approved' : 'New order', c ? 'sent to our kitchen' : 'Kitchen to start'],
    ['Processing', 'In production', c ? 'being made' : 'Admin to dispatch'],
    [method === 'pickup' ? 'Ready for Pickup' : 'Out for Delivery', method === 'pickup' ? 'Ready for pickup' : 'Out for delivery', c ? (method === 'pickup' ? 'collect it' : 'on the way') : 'Customer to receive'],
    ['Received', 'Received', c ? 'check & confirm' : 'Done'],
  ]
}

// Horizontal progress bar; the current step takes the status colour
export function Stepper({ status, method = 'delivery', audience = 'staff' }) {
  if (status === 'Rejected') return <div className="stepper cancelled"><Icon name="CircleX" size={16} /> This order was not approved</div>
  if (status === 'Cancelled') return <div className="stepper cancelled"><Icon name="CircleX" size={16} /> This order was cancelled</div>
  const steps = STEPS(method, audience)
  const idx = steps.findIndex(([s]) => s === (status === 'Invoiced' ? 'Confirmed' : status))
  const finished = status === 'Received'
  return (
    <ol className={`stepper tone-${toneOf(status)}`}>
      {steps.map(([s, label, who], i) => (
        <li key={s} className={i < idx || finished ? 'done' : i === idx ? 'current' : ''}>
          <span className="dot" aria-hidden="true"><Icon name={i < idx || finished ? 'Check' : STATUS_ICON[s]} size={16} /></span>
          <span className="step-label">{label}<span className="step-who">{who}</span></span>
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
        <li key={e.id} className={`tone-${toneOf(e.status)}`}>
          <div className="event-time">{fmtDateTime(e.created_at)}</div>
          <div><strong>{e.status === 'Pending' ? 'Awaiting approval' : e.status}</strong> — {e.note}{e.user_name && <span className="muted small"> · {e.user_name}</span>}</div>
        </li>
      ))}
    </ul>
  )
}
