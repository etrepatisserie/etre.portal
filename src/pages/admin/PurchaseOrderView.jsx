import { useEffect, useState, useCallback } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { api, money } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import Icon from '../../components/Icon.jsx'

// Which workflow buttons to show for each status
const ACTIONS = {
  Draft: [['Submitted', 'Submit', 'primary'], ['Cancelled', 'Cancel PO', 'danger']],
  Submitted: [['Approved', 'Approve', 'primary'], ['Draft', 'Return to draft', 'secondary'], ['Cancelled', 'Cancel PO', 'danger']],
  Approved: [['Received', 'Mark received', 'primary'], ['Cancelled', 'Cancel PO', 'danger']],
  Received: [],
  Cancelled: [],
}

export default function PurchaseOrderView() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [po, setPo] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    api.get(`/admin/purchase-orders/${id}`).then(setPo).catch((e) => setError(e.message))
  }, [id])
  useEffect(load, [load])

  const changeStatus = async (status) => {
    setError('')
    try { await api.post(`/admin/purchase-orders/${id}/status`, { status }); load() } catch (e) { setError(e.message) }
  }

  const remove = async () => {
    if (!confirm(`Delete ${po.po_number}? This cannot be undone.`)) return
    try { await api.del(`/admin/purchase-orders/${id}`); navigate('/admin/purchasing/orders') } catch (e) { setError(e.message) }
  }

  if (error && !po) return <div className="alert error">{error}</div>
  if (!po) return <p>Loading…</p>

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="breadcrumb"><Link to="/admin/purchasing/orders">Purchase Orders</Link> / {po.po_number}</div>
          <h1>{po.po_number} <StatusBadge status={po.status} /></h1>
        </div>
        <div className="actions inline">
          {po.status === 'Draft' && <>
            <Link to={`/admin/purchasing/orders/${id}/edit`} className="btn secondary">Edit</Link>
            <button className="btn ghost" onClick={remove}>Delete</button>
          </>}
          {ACTIONS[po.status].map(([s, label, style]) => (
            <button key={s} className={`btn ${style}`} onClick={() => changeStatus(s)}>{label}</button>
          ))}
          <button className="btn ghost" onClick={() => window.print()}><Icon name="Printer" size={18} /> Print</button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="card">
        <div className="info-grid">
          <div>
            <div className="label">Supplier</div>
            <div><strong>{po.supplier_name}</strong> ({po.supplier_code})</div>
            {po.supplier_contact && <div className="muted">{po.supplier_contact}</div>}
            {po.supplier_email && <div className="muted">{po.supplier_email}</div>}
            {po.supplier_address && <div className="muted">{po.supplier_address}</div>}
          </div>
          <div>
            <div className="label">Order date</div><div>{po.order_date}</div>
            <div className="label">Expected delivery</div><div>{po.expected_date || '—'}</div>
          </div>
          <div>
            <div className="label">Created</div><div>{po.created_at}</div>
            <div className="label">Last updated</div><div>{po.updated_at}</div>
          </div>
        </div>
        {po.notes && <><div className="label">Notes</div><p>{po.notes}</p></>}
      </div>

      <div className="card">
        <h2>Line items</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>#</th><th>SKU</th><th>Description</th><th className="num">Qty</th><th>UoM</th>
                <th className="num">Unit price</th><th className="num">Amount</th></tr>
            </thead>
            <tbody>
              {po.lines.map((l) => (
                <tr key={l.id}>
                  <td>{l.line_no}</td><td>{l.sku || '—'}</td><td>{l.description}</td>
                  <td className="num">{l.quantity}</td><td>{l.uom || '—'}</td>
                  <td className="num">{money(l.unit_price)}</td><td className="num">{money(l.line_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="totals">
          <div><span>Subtotal</span><span>{money(po.subtotal)}</span></div>
          <div><span>Tax ({po.tax_rate}%)</span><span>{money(po.tax_amount)}</span></div>
          <div className="grand"><span>Total</span><span>{money(po.total)}</span></div>
        </div>
      </div>
    </div>
  )
}
