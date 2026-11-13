// One colour ("tone") per status, used by badges, the progress bar, list rows and dashboards.
// Order stages:  Pending = amber · Confirmed = blue · Invoiced = violet · Processing = teal
//                Ready for pickup / Out for delivery = rose · Received = green · Cancelled = grey
export const TONE = {
  // orders
  Pending: 'amber', Confirmed: 'blue', Invoiced: 'violet', Released: 'violet', Processing: 'teal',
  'Ready for Pickup': 'rose', 'Out for Delivery': 'rose', Received: 'green', Cancelled: 'gray',
  // payments
  Unpaid: 'red', 'Slip Uploaded': 'amber', Paid: 'green', Rejected: 'red-solid', Verified: 'green',
  // other
  Approved: 'green', Open: 'red', Resolved: 'green', Live: 'green', Scheduled: 'blue', Expired: 'gray',
  COD: 'gray', NET14: 'blue', NET15: 'blue', NET30: 'violet', OK: 'green', Low: 'amber', Out: 'red', Active: 'violet', Fulfilled: 'green',
  receipt: 'green', sale: 'blue', adjustment: 'gray', logged: 'blue', sent: 'green', failed: 'red',
  Draft: 'gray', Submitted: 'amber',
  // credit notes
  Requested: 'amber', Issued: 'green',
}
export const toneOf = (status) => TONE[status] || 'gray'

// The order process: who acts at each stage and what they do.
// Orders go straight to the kitchen; Finance invoices alongside (not a stage).
export const FLOW = [
  { status: 'Confirmed', label: 'New order', who: 'Kitchen', todo: 'Print & start' },
  { status: 'Processing', label: 'In production', who: 'Admin', todo: 'Dispatch' },
  { status: 'Ready for Pickup', label: 'Ready / Out', who: 'Customer', todo: 'Receive', also: 'Out for Delivery' },
  { status: 'Received', label: 'Received', who: null, todo: 'Done' },
]
export const flowStep = (status) => FLOW.find((f) => f.status === status || f.also === status)
