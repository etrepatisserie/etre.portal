import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, money } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'

const STATUSES = ['', 'Draft', 'Submitted', 'Approved', 'Received', 'Cancelled']

export default function PurchaseOrderList() {
  const [orders, setOrders] = useState([])
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (q) params.set('q', q)
    api.get(`/admin/purchase-orders?${params}`).then(setOrders)
  }, [status, q])

  return (
    <div>
      <div className="page-header">
        <h1>Purchase Orders</h1>
        <Link to="/admin/purchasing/orders/new" className="btn primary">+ New Purchase Order</Link>
      </div>

      <div className="card">
        <div className="toolbar">
          <input placeholder="Search PO # or supplier…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => <option key={s} value={s}>{s || 'All statuses'}</option>)}
          </select>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>PO #</th><th>Supplier</th><th>Order date</th><th>Expected</th>
                <th>Status</th><th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 && (
                <tr><td colSpan="6" className="empty">No purchase orders yet. <Link to="/admin/purchasing/orders/new">Create one</Link>.</td></tr>
              )}
              {orders.map((o) => (
                <tr key={o.id} className="clickable" onClick={() => navigate(`/admin/purchasing/orders/${o.id}`)}>
                  <td><strong>{o.po_number}</strong></td>
                  <td>{o.supplier_name}</td>
                  <td>{o.order_date}</td>
                  <td>{o.expected_date || '—'}</td>
                  <td><StatusBadge status={o.status} /></td>
                  <td className="num">{money(o.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
