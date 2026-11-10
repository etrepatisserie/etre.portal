// Status always shows as icon + text, never color alone
const ICON = {
  Draft: '○', Submitted: '◔', Approved: '◑', Received: '●', Cancelled: '✕',
  Pending: '○', Confirmed: '◔', Packed: '◑', Shipped: '➜', Delivered: '✓',
  OK: '✓', Low: '!', Out: '✕', Active: '⏸', Released: '↺', Fulfilled: '✓',
  receipt: '↓', sale: '↑', adjustment: '±',
}
const LABEL = { OK: 'In stock', Low: 'Low stock', Out: 'Out of stock', receipt: 'Receipt', sale: 'Sale', adjustment: 'Adjustment' }

export default function StatusBadge({ status }) {
  return (
    <span className={`badge badge-${status.toLowerCase()}`}>
      <span aria-hidden="true">{ICON[status]}</span> {LABEL[status] || status}
    </span>
  )
}
