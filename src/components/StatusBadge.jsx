import { toneOf } from '../status.js'
import { STATUS_ICON } from '../icons.js'
import Icon from './Icon.jsx'

// Status always shows as icon + text, never colour alone. Colour comes from status.js.
const LABEL = { Pending: 'Awaiting approval', OK: 'In stock', Low: 'Low stock', Out: 'Out of stock', receipt: 'Receipt', sale: 'Sale', adjustment: 'Adjustment', NET14: '14-day term', NET15: '15-day term', NET30: '30-day term', logged: 'Logged', sent: 'Sent', failed: 'Failed' }

export default function StatusBadge({ status, label, tone, icon }) {
  if (!status) return null
  return (
    <span className={`badge tone-${tone || toneOf(status)}`}>
      <Icon name={icon || STATUS_ICON[status] || 'CircleDot'} size={14} /> {label || LABEL[status] || status}
    </span>
  )
}
