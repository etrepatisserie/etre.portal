import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, money, fmtDay } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import { toneOf } from '../../status.js'
import Todo from '../../components/Todo.jsx'
import OutletTag, { useShowOutlet } from '../../components/OutletTag.jsx'
import Icon from '../../components/Icon.jsx'

export default function Dashboard() {
  const [d, setD] = useState(null)
  const [error, setError] = useState('')
  const showOutlet = useShowOutlet()
  useEffect(() => { api.get('/admin/dashboard').then(setD).catch((e) => setError(e.message)) }, [])

  if (error) return <div className="alert error">Cannot reach the API server: {error}. Is <code>npm run dev</code> running?</div>
  if (!d) return <p>Loading…</p>

  return (
    <div>
      <div className="page-header">
        <h1>Dashboard</h1>
        <Link to="/admin/sales/new" className="btn secondary"><Icon name="Plus" size={18} /> New Sale</Link>
      </div>

      <p className="section-label">Your to-do</p>
      <div className="todo">
        <Todo icon="ChefHat" n={d.counts.inKitchen} tone="blue" what="New orders in the kitchen" hint="Adjust only if something is short" to="/admin/sales?status=Confirmed" go="View" />
        <Todo icon="Truck" n={d.counts.dispatchToday} tone="teal" what="To dispatch today" hint={d.counts.dispatchLate ? `incl. ${d.counts.dispatchLate} late — past their date` : 'Pickup / delivery date is today'} to="/admin/sales?status=DispatchToday" go="Dispatch" />
        <Todo icon="CalendarDays" n={d.counts.dispatchLater} tone="violet" what="Yet to dispatch" hint="Later pickup / delivery dates" to="/admin/sales?status=DispatchLater" go="View" />
        <Todo icon="MessageSquareWarning" n={d.counts.openDiscrepancies} tone="red" what="Customer complaints" hint="Offer a credit note or a replacement" to="/admin/discrepancies" go="Resolve" />
        <Todo icon="AlertTriangle" n={d.lowStock.length} tone="amber" what="Ingredients running low" hint="Create a purchase order" to="/admin/stock?status=alert" go="Review" />
      </div>

      <div className="two-col">
        <div className="card">
          <div className="card-head"><h2>Latest orders</h2><Link to="/admin/sales">All orders →</Link></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Order #</th><th>Customer</th><th>For</th><th>Status</th><th className="num">Total</th></tr></thead>
              <tbody>
                {d.recent.map((o) => (
                  <tr key={o.id} className={`tone-${toneOf(o.status)}`}>
                    <td><Link to={`/admin/sales/${o.id}`}>{o.so_number}</Link>{showOutlet && <OutletTag code={o.outlet_code} />}</td>
                    <td>{o.customer_name}</td><td className="small">{o.method === 'pickup' ? 'Pickup' : 'Delivery'} {fmtDay(o.fulfil_date)}</td>
                    <td><StatusBadge status={o.status} /></td><td className="num">{money(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <h2>This month</h2>
          <div className="stats small">
            <div className="stat"><div className="stat-label">Sales (before SST)</div><div className="stat-value">{money(d.thisMonth.total)}</div><div className="stat-sub">{d.thisMonth.count} orders · last month {money(d.lastMonth.total)}</div></div>
            <div className="stat"><div className="stat-label">Today</div><div className="stat-value">{money(d.today.total)}</div><div className="stat-sub">{d.today.count} orders</div></div>
          </div>
          {d.lowStock.length > 0 && <>
            <div className="label">Ingredients to reorder</div>
            {d.lowStock.map((p) => <div key={`${p.id}-${p.outlet_id}`} className="doc-row"><span>{p.name}{showOutlet && <OutletTag code={p.outlet_code} />}</span><span>{p.available} {p.uom} <StatusBadge status={p.stock_status} /></span></div>)}
            <div className="actions"><Link to="/admin/purchasing/orders/new" className="btn ghost">Create purchase order</Link></div>
          </>}
        </div>
      </div>
    </div>
  )
}
