import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, money, fmtDay, fmtDayLong, todayMY } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import { toneOf, orderStatus } from '../../status.js'
import Todo from '../../components/Todo.jsx'
import OutletTag, { useShowOutlet } from '../../components/OutletTag.jsx'
import Icon from '../../components/Icon.jsx'
import { PageSkeleton } from '../../components/Skeleton.jsx'

export default function Dashboard() {
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const showOutlet = useShowOutlet()
  const [day] = useState(todayMY)
  useEffect(() => { api.get('/admin/dashboard').then(setD).catch((e) => setError(e.message)) }, [])

  if (error) return <div className="alert error">Cannot reach the API server: {error}. Is <code>npm run dev</code> running?</div>
  if (!d) return <PageSkeleton cards={5} />

  return (
    <div>
      <div className="page-header">
        <div><h1>Dashboard</h1><div className="page-date">{fmtDayLong(day)}</div></div>
        <Link to="/admin/sales/new" className="btn secondary"><Icon name="Plus" size={18} /> New Sale</Link>
      </div>

      <p className="section-label">Orders — needs your attention</p>
      <div className="todo">
        <Todo icon="Hourglass" n={d.counts.awaitingApproval} tone={d.counts.approvalUrgent ? 'red' : 'amber'} what="Orders awaiting approval"
          hint={d.counts.approvalUrgent ? `${d.counts.approvalUrgent} urgent — production today or tomorrow` : 'Approve, adjust or reject before they reach the kitchen'} to="/admin/sales?status=Pending" go="Review" />
        <Todo icon="ChefHat" n={d.counts.inKitchen} tone="blue" what="New orders in the kitchen" hint="Adjust only if something is short" to="/admin/sales?status=Confirmed" go="View" />
        <Todo icon="CircleX" n={d.counts.rejectedRecent} tone="gray" what="Rejected (last 7 days)" hint="Customers were told the reason" to="/admin/sales?status=Rejected" go="View" />
        <Todo icon="Plus" n={d.counts.addonsOpen} tone="navy" what="Add-on orders" hint="Extra orders linked to an earlier one" to="/admin/sales?status=Addons" go="View" />
        <Todo icon="AlertCircle" n={d.counts.incomplete} tone="amber" what="Missing information" hint="No delivery address or time slot" to="/admin/sales?status=Incomplete" go="Fix" />
        <Todo icon="CalendarDays" n={d.counts.closureAffected} tone="red" what="On a closed date" hint="Agree a new date — not moved automatically" to="/admin/closures" go="Review" />
      </div>
      <p className="section-label">Dispatch</p>
      <div className="todo">
        <Todo icon="Truck" n={d.counts.dispatchToday} tone="blue" what="To dispatch today" hint={d.counts.dispatchLate ? `incl. ${d.counts.dispatchLate} late — past their date` : 'Pickup / delivery date is today'} to="/admin/sales?status=DispatchToday" go="Dispatch" />
        <Todo icon="CalendarDays" n={d.counts.dispatchLater} tone="navy" what="Yet to dispatch" hint="Later pickup / delivery dates" to="/admin/sales?status=DispatchLater" go="View" />
        <Todo icon="PackageCheck" n={d.counts.pendingCollection} tone="navy" what="Waiting for collection" hint="Ready for pickup" to="/admin/sales?status=Ready for Pickup" go="View" />
        <Todo icon="Truck" n={d.counts.outForDelivery} tone="navy" what="Out for delivery" hint="Customer confirms receipt" to="/admin/sales?status=Out for Delivery" go="View" />
        <Todo icon="AlertTriangle" n={d.counts.failedDelivery} tone="red" what="Failed deliveries" hint="Rebook the delivery" to="/admin/sales?status=FailedDelivery" go="Rebook" />
        <Todo icon="CircleCheck" n={d.counts.completedWeek} tone="green" what="Completed (7 days)" hint="Received by customers" to="/admin/sales?status=Received" go="View" />
        <Todo icon="MessageSquareWarning" n={d.counts.openDiscrepancies} tone="red" what="Customer complaints" hint="Offer a credit note or a replacement" to="/admin/discrepancies" go="Resolve" />
        <Todo icon="AlertTriangle" n={d.lowStock.length} tone="amber" what="Ingredients running low" hint="Create a purchase order" to="/admin/stock?status=alert" go="Review" />
      </div>

      <p className="section-label">This month</p>
      <div className="kpis">
        <div className="stat"><div className="stat-label">Sales this month · before SST</div><div className="stat-value">{money(d.thisMonth.total)}</div>
          <div className="stat-sub">{d.thisMonth.count} order{d.thisMonth.count === 1 ? '' : 's'} so far</div></div>
        <div className="stat"><div className="stat-label">Last month · before SST</div><div className="stat-value">{money(d.lastMonth.total)}</div><div className="stat-sub">full month, for comparison</div></div>
        <div className="stat"><div className="stat-label">Today</div><div className="stat-value">{money(d.today.total)}</div><div className="stat-sub">{d.today.count} order{d.today.count === 1 ? '' : 's'}</div></div>
      </div>

      <div className={d.lowStock.length ? 'dash-grid' : ''}>
        <div className="card flush">
          <div className="card-head card-pad"><h2>Latest orders</h2><Link to="/admin/sales" className="linkish">All orders <Icon name="ArrowRight" size={14} /></Link></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Order</th><th>Customer</th><th>Pickup / delivery</th><th>Status</th><th className="num">Total</th></tr></thead>
              <tbody>
                {d.recent.map((o) => (
                  <tr key={o.id} className={`tone-${toneOf(o.status)}`}>
                    <td><Link to={`/admin/sales/${o.id}`} className="strong-link">{o.so_number}</Link>{showOutlet && <OutletTag code={o.outlet_code} />}</td>
                    <td>{o.customer_name}</td><td>{o.method === 'pickup' ? 'Pickup' : 'Delivery'}<div className="muted small">{fmtDay(o.fulfil_date)}</div></td>
                    <td><StatusBadge status={orderStatus(o)} /></td><td className="num">{money(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        {d.lowStock.length > 0 && (
          <div className="card">
            <div className="card-head"><h2>Ingredients to reorder</h2></div>
            {d.lowStock.map((p) => <div key={`${p.id}-${p.outlet_id}`} className="doc-row"><span>{p.name}{showOutlet && <OutletTag code={p.outlet_code} />}</span><span>{p.available} {p.uom} <StatusBadge status={p.stock_status} /></span></div>)}
            <div className="actions" style={{ marginTop: 12 }}><Link to="/admin/purchasing/orders/new" className="btn secondary"><Icon name="Plus" size={18} /> Create purchase order</Link></div>
          </div>
        )}
      </div>
    </div>
  )
}
