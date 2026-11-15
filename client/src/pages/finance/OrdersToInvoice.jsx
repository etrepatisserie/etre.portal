import { useEffect, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, upload, money, fmtDay, fmtDateTime } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import CustomerFilter, { matchesCustomer } from '../../components/CustomerFilter.jsx'
import OutletTag, { useShowOutlet } from '../../components/OutletTag.jsx'
import FileLink from '../../components/FileLink.jsx'
import Icon from '../../components/Icon.jsx'

// Confirmed orders waiting for an invoice. One click issues it (generated PDF); "Review" to upload your own copy.
export default function OrdersToInvoice() {
  const [rows, setRows] = useState(null)
  const [busy, setBusy] = useState(null)
  const [done, setDone] = useState([])
  const [error, setError] = useState('')
  const [customer, setCustomer] = useState('')
  const navigate = useNavigate()
  const showOutlet = useShowOutlet()
  const load = useCallback(() => api.get('/finance/orders-to-invoice').then(setRows), [])
  useEffect(() => { load() }, [load])

  const issue = async (e, o) => {
    e.stopPropagation(); setBusy(o.id); setError('')
    try {
      const fd = new FormData(); fd.append('mode', 'generate')
      const inv = await upload(`/finance/orders/${o.id}/invoice`, fd)
      setDone([{ ...inv, customer_name: o.customer_name, so_number: o.so_number }, ...done])
      load(); window.dispatchEvent(new Event('notifications:refresh'))
    } catch (err) { setError(`${o.so_number}: ${err.message}`) } finally { setBusy(null) }
  }
  if (!rows) return <p>Loading…</p>
  const shown = rows.filter((o) => matchesCustomer(o.customer_name, customer))

  return (
    <div>
      <div className="page-header"><h1>Orders to Invoice</h1></div>
      <p className="muted">Every new order lands here — the kitchen is already making it. Press <strong>Issue invoice</strong> to create the invoice and delivery order PDFs and email the customer, or <strong>Review</strong> to upload your own file.</p>
      <div className="toolbar"><CustomerFilter value={customer} onChange={setCustomer} /></div>
      {error && <div className="alert error">{error}</div>}
      {done.length > 0 && (
        <div className="alert success">
          {done.map((i) => <div key={i.id}><Icon name="CircleCheck" size={16} /> <strong>{i.inv_number}</strong> issued for {i.so_number} ({i.customer_name}) · <FileLink url={`/documents/invoices/${i.id}/invoice`}>View PDF</FileLink></div>)}
        </div>
      )}
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>Order</th><th>Customer</th><th>Term</th><th>Placed</th><th>Payment</th><th>Pickup / delivery</th><th className="num">Total incl. SST</th><th className="row-action">Next</th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan="8" className="empty"><Icon name="CircleCheck" size={24} className="empty-icon" />Nothing to invoice{customer ? ' for this customer' : ''}.</td></tr>}
              {shown.map((o) => (
                <tr key={o.id} className="clickable tone-blue" onClick={() => navigate(`/finance/invoices/new/${o.id}`)}>
                  <td><strong>{o.so_number}</strong>{showOutlet && <OutletTag code={o.outlet_code} />}</td><td>{o.customer_name}</td><td><StatusBadge status={o.payment_term} /></td>
                  <td className="small muted">{fmtDateTime(o.order_date)}</td>
                  <td>{o.slip_status ? <StatusBadge status="Slip Uploaded" label="COD slip attached" /> : <span className="muted small">{o.payment_term === 'NET14' ? '14-day term' : 'No slip'}</span>}</td>
                  <td>{o.method === 'pickup' ? 'Pickup' : 'Delivery'} · {fmtDay(o.fulfil_date)}</td>
                  <td className="num">{money(o.total)}</td>
                  <td className="row-action">
                    <Link to={`/finance/invoices/new/${o.id}`} className="btn ghost" onClick={(e) => e.stopPropagation()}>Review</Link>{' '}
                    <button className="btn primary" disabled={busy === o.id} onClick={(e) => issue(e, o)}>{busy === o.id ? 'Issuing…' : <><Icon name="FileText" size={18} /> Issue invoice</>}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
