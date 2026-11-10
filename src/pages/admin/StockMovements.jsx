import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, fmtDateTime, num } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'

export default function StockMovements() {
  const [params, setParams] = useSearchParams()
  const productId = params.get('product_id') || ''
  const type = params.get('type') || ''
  const [rows, setRows] = useState([])
  const [stock, setStock] = useState([])
  useEffect(() => { api.get('/admin/stock').then(setStock) }, [])
  useEffect(() => {
    const p = new URLSearchParams()
    if (productId) p.set('product_id', productId)
    if (type) p.set('type', type)
    api.get(`/admin/stock/movements?${p}`).then(setRows)
  }, [productId, type])

  const setFilter = (k, v) => { const p = new URLSearchParams(params); v ? p.set(k, v) : p.delete(k); setParams(p) }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="breadcrumb"><Link to="/admin/stock">Stock Tracking</Link> / Movements</div>
          <h1>Stock Movements</h1>
        </div>
      </div>
      <div className="card">
        <div className="toolbar">
          <select value={productId} onChange={(e) => setFilter('product_id', e.target.value)}>
            <option value="">All products</option>{stock.map((s) => <option key={s.id} value={s.id}>{s.sku} · {s.name}</option>)}
          </select>
          <select value={type} onChange={(e) => setFilter('type', e.target.value)}>
            <option value="">All movement types</option><option value="receipt">Receipts</option><option value="sale">Sales</option><option value="adjustment">Adjustments</option>
          </select>
        </div>
        <div className="muted small table-caption">Showing the latest {rows.length} movements</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Product</th><th>Type</th><th className="num">Qty</th><th className="num">Balance</th><th>Reason</th><th>Ref</th><th>By</th></tr></thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td className="muted small">{fmtDateTime(m.created_at)}</td>
                  <td>{m.product_name}<div className="muted small">{m.sku}</div></td>
                  <td><StatusBadge status={m.type} /></td>
                  <td className={`num ${m.qty < 0 ? 'neg' : 'pos'}`}>{m.qty > 0 ? '+' : ''}{num(m.qty)}</td>
                  <td className="num">{num(m.balance_after)}</td>
                  <td className="small">{m.reason}</td><td className="small">{m.ref || '—'}</td><td className="small muted">{m.user_name || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
