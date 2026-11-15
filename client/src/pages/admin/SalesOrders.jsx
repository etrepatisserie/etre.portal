import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { api, money, fmtDateTime, fmtDay } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import FlowLegend from '../../components/FlowLegend.jsx'
import { toneOf, flowStep, orderStatus } from '../../status.js'
import { useConfirm } from '../../feedback.js'
import OutletTag, { useShowOutlet } from '../../components/OutletTag.jsx'
import Icon from '../../components/Icon.jsx'
import Flash from '../../components/Flash.jsx'

const OPEN = ['Pending', 'Confirmed', 'Invoiced', 'Processing'] // not yet dispatched

export default function SalesOrders() {
  const [params, setParams] = useSearchParams()
  // default view = open orders (what still needs work); status=all shows everything
  const status = params.get('status') ?? 'Open'
  const [q, setQ] = useState(params.get('q') || '')
  const [orders, setOrders] = useState([])
  const [counts, setCounts] = useState({})
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const navigate = useNavigate()
  const confirm = useConfirm()
  const showOutlet = useShowOutlet()
  const [today] = useState(() => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)) // Malaysia date
  const [tomorrow] = useState(() => new Date(Date.now() + 32 * 3600e3).toISOString().slice(0, 10))

  const load = useCallback(() => {
    const p = new URLSearchParams()
    if (status && status !== 'all') p.set('status', status)
    if (q) p.set('q', q)
    api.get(`/admin/sales-orders?${p}`).then(setOrders)
    api.get('/admin/dashboard').then((d) => {
      const c = Object.fromEntries(d.pipeline.map((x) => [x.status, x.count]))
      c['Ready for Pickup'] = (c['Ready for Pickup'] || 0) + (c['Out for Delivery'] || 0)
      setCounts({ ...c, _today: d.counts.dispatchToday, _late: d.counts.dispatchLate, _later: d.counts.dispatchLater })
    })
  }, [status, q])
  useEffect(() => { load() }, [load])

  // one-click actions straight from the list
  const act = async (e, o, kind) => {
    e.stopPropagation(); setBusy(o.id); setMsg(null)
    try {
      await api.post(`/admin/sales-orders/${o.id}/dispatch`)
      setMsg({ ok: true, text: `${o.so_number}: ${o.method === 'pickup' ? 'ready for pickup — customer notified.' : 'out for delivery — customer notified.'}` })
      load(); window.dispatchEvent(new Event('notifications:refresh'))
    } catch (err) { setMsg({ ok: false, text: `${o.so_number}: ${err.message}` }) } finally { setBusy(null) }
  }

  // awaiting approval: approve in one click, or reject with a reason the customer will see
  const approve = async (e, o) => {
    e.stopPropagation(); setBusy(o.id); setMsg(null)
    try { await api.post(`/admin/sales-orders/${o.id}/approve`); setMsg({ ok: true, text: `${o.so_number} approved — sent to the kitchen, Finance asked to invoice.` }); load(); window.dispatchEvent(new Event('notifications:refresh')) }
    catch (err) { setMsg({ ok: false, text: `${o.so_number}: ${err.message}` }) } finally { setBusy(null) }
  }
  const reject = async (e, o) => {
    e.stopPropagation()
    const reason = await confirm({ title: `Reject ${o.so_number}?`, body: `${o.customer_name} is told it won't be made.`, input: { label: 'Reason for the customer', placeholder: 'e.g. We are closed on that date', required: true }, confirmLabel: 'Reject order', danger: true })
    if (reason == null) return
    setBusy(o.id); setMsg(null)
    try { await api.post(`/admin/sales-orders/${o.id}/reject`, { reason }); setMsg({ ok: true, text: `${o.so_number} rejected — customer notified.` }); load(); window.dispatchEvent(new Event('notifications:refresh')) }
    catch (err) { setMsg({ ok: false, text: `${o.so_number}: ${err.message}` }) } finally { setBusy(null) }
  }

  const rowAction = (o) => {
    if (o.status === 'Pending') return <span className="row-buttons"><button className="btn primary" disabled={busy === o.id} onClick={(e) => approve(e, o)}><Icon name="CircleCheck" size={18} /> Approve</button><button className="btn secondary" disabled={busy === o.id} onClick={(e) => reject(e, o)}>Reject</button></span>
    if (o.status === 'Processing') return <button className="btn primary" disabled={busy === o.id} onClick={(e) => act(e, o, 'dispatch')}>{o.method === 'pickup' ? <><Icon name="PackageCheck" size={18} /> Ready for pickup</> : <><Icon name="Truck" size={18} /> Out for delivery</>}</button>
    if (o.open_discrepancies > 0) return <Link className="btn danger" to="/admin/discrepancies" onClick={(e) => e.stopPropagation()}>Resolve issue</Link>
    const f = flowStep(o.status)
    return <span className="waiting">{f?.who ? `Waiting: ${f.who}` : o.status === 'Received' ? 'Done' : '—'}</span>
  }

  return (
    <div>
      <div className="page-header">
        <h1>Sales Orders</h1>
        <Link to="/admin/sales/new" className="btn secondary"><Icon name="Plus" size={18} /> New Sale</Link>
      </div>

      <FlowLegend counts={counts} active={status === 'Dispatched' ? 'Ready for Pickup' : status} onPick={(s) => setParams({ status: s === status ? 'Open' : s })} />

      <Flash msg={msg} />
      <div className="card">
        <div className="toolbar">
          <label className="search-box"><Icon name="Search" size={16} /><input aria-label="Search order # or customer" placeholder="Search order # or customer…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <div className="chips inline">
            {[['Pending', 'Awaiting approval', counts.Pending || 0], ['DispatchToday', 'To dispatch today', counts._today], ['DispatchLater', 'Yet to dispatch', counts._later], ['Open', 'Open orders'], ['all', 'All orders'], ['Rejected', 'Rejected'], ['Cancelled', 'Cancelled']].map(([f, label, n]) => (
              <button key={f} className={`chip ${status === f ? 'on' : ''}`} onClick={() => setParams({ status: f })}>{label}{n != null && <span className="chip-count">{n}</span>}</button>
            ))}
          </div>
        </div>
        {status === 'DispatchToday' && <p className="small table-caption">Orders whose pickup / delivery date is <strong>today</strong>{counts._late ? <>, plus <strong className="neg">{counts._late} late</strong> (date already passed)</> : ''}. Dispatch once the kitchen has finished (status In production).</p>}
        {['Addons', 'FailedDelivery', 'Incomplete'].includes(status) && <p className="small table-caption"><strong>{{ Addons: 'Open add-on orders', FailedDelivery: 'Failed deliveries — rebook them', Incomplete: 'Orders missing a delivery address or time slot' }[status]}</strong> · <button type="button" className="linkish" onClick={() => setParams({ status: 'Open' })}>Show all open orders</button></p>}
        {status === 'Pending' && <p className="small table-caption">New customer orders. Nothing reaches the kitchen or Finance until you <strong>approve</strong> it — most urgent production date first. Open an order to adjust quantities.</p>}
        {status === 'DispatchLater' && <p className="small table-caption">Not dispatched yet, for <strong>later dates</strong> — earliest first. Nothing to hand over today.</p>}
        <div className="muted small table-caption">{orders.length} orders · {money(orders.filter((o) => o.status !== 'Cancelled').reduce((a, o) => a + o.total, 0))} incl. SST</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Order #</th><th>Customer</th><th>Pickup / delivery</th><th>Status</th><th>Payment</th><th className="num">Total</th><th className="row-action">Next</th></tr></thead>
            <tbody>
              {orders.length === 0 && <tr><td colSpan="7" className="empty"><Icon name="Inbox" size={24} className="empty-icon" />No orders here.</td></tr>}
              {orders.map((o) => (
                <tr key={o.id} className={`clickable tone-${toneOf(o.status)}`} onClick={() => navigate(`/admin/sales/${o.id}`)}>
                  <td><strong>{o.so_number}</strong>{showOutlet && <OutletTag code={o.outlet_code} />}{o.addon_of && <span className="tag addon-tag">Add-on</span>}{o.failed_at && o.status === 'Processing' && <div><StatusBadge status="Late" label="Failed delivery — rebook" /></div>}<div className="muted small">{fmtDateTime(o.order_date)}</div></td>
                  <td>{o.customer_name}</td>
                  <td>{o.method === 'pickup' ? 'Pickup' : 'Delivery'} · {o.fulfil_date === today ? <strong>Today</strong> : fmtDay(o.fulfil_date)}{o.time_slot && <div className="muted small">{o.time_slot}</div>}{o.fulfil_date < today && OPEN.includes(o.status) && <div><StatusBadge status="Late" label="Late — not dispatched" /></div>}</td>
                  <td><StatusBadge status={orderStatus(o)} />{o.status === 'Pending' && o.production_date <= tomorrow && <div className="small neg"><Icon name="AlertTriangle" size={14} /> Urgent — production {o.production_date === today ? 'today' : 'tomorrow'}</div>}</td>
                  <td>{o.inv_number ? <StatusBadge status={o.payment_status} /> : o.status === 'Cancelled' ? <span className="muted">—</span> : o.replacement_for ? <span className="tag">Replacement · no charge</span> : <span className="muted small">Not invoiced yet</span>}</td>
                  <td className="num">{money(o.total)}</td>
                  <td className="row-action">{rowAction(o)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
