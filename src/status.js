// One colour ("tone") per status, used by badges, the progress bar, list rows and dashboards.
// Semantic only: green = done / paid · amber = waiting / needs attention · red = failed, overdue, late
//                blue = informational / in progress · navy = handed over (ready / out) · gray = cancelled, inactive
// Every status also shows an icon (src/icons.js) and a word, so nothing relies on colour alone.
export const TONE = {
  // orders: New order = amber · In production = blue · Ready / Out = navy · Received = green · Cancelled = gray · Late = red
  Pending: 'amber', Confirmed: 'amber', Invoiced: 'gray', Released: 'gray', Processing: 'blue',
  'Ready for Pickup': 'navy', 'Out for Delivery': 'navy', Received: 'green', Cancelled: 'gray', Late: 'red',
  // invoices / payments: Unpaid = amber · Slip uploaded = blue · Paid = green · Rejected / Overdue = red
  Unpaid: 'amber', 'Slip Uploaded': 'blue', Paid: 'green', Rejected: 'red', Overdue: 'red', Verified: 'green',
  // credit notes: To issue = amber · Issued = green · Declined = gray (pass tone="gray" for a declined credit note)
  Requested: 'amber', Issued: 'green', Declined: 'gray',
  // supplier bills: To record = amber · Unpaid = blue · Overdue = red · Paid = green (set on the Payables page)
  // complaints, terms, content, stock, purchasing, email
  Open: 'amber', Resolved: 'green', Approved: 'green', Live: 'green', Scheduled: 'blue', Expired: 'gray',
  COD: 'gray', NET14: 'blue', NET15: 'blue', NET30: 'blue', OK: 'green', Low: 'amber', Out: 'red', Active: 'blue', Fulfilled: 'green',
  receipt: 'green', sale: 'blue', adjustment: 'gray', logged: 'blue', sent: 'green', failed: 'red',
  Draft: 'gray', Submitted: 'amber',
}
export const toneOf = (status) => TONE[status] || 'gray'
// What to show for an order: 'Pending' means awaiting Admin approval; a rejected order is stored as Cancelled
export const orderStatus = (o) => (o?.rejected_at ? 'Rejected' : o?.status)
export const ORDER_LABEL = { Pending: 'Awaiting approval', Rejected: 'Rejected' }

// The order process: who acts at each stage and what they do.
// Orders go straight to the kitchen; Finance invoices alongside (not a stage).
export const FLOW = [
  { status: 'Pending', label: 'Awaiting approval', who: 'Admin', todo: 'Approve' },
  { status: 'Confirmed', label: 'New order', who: 'Kitchen', todo: 'Print & start' },
  { status: 'Processing', label: 'In production', who: 'Admin', todo: 'Dispatch' },
  { status: 'Ready for Pickup', label: 'Ready / Out', who: 'Customer', todo: 'Receive', also: 'Out for Delivery' },
  { status: 'Received', label: 'Received', who: null, todo: 'Done' },
]
export const flowStep = (status) => FLOW.find((f) => f.status === status || f.also === status)
