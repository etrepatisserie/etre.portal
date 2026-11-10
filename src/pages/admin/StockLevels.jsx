import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, money, num } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'

// Stock tracking: on hand vs on hold vs available, per product
export default function StockLevels() {
  const [params] = useSearchParams()
  const focus = params.get('focus')
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [category, setCategory] = useState('')
  const [status, setStatus] = useState(params.get('status') || '')
  useEffect(() => { api.get('/admin/stock').then(setRows) }, [])

  const categories = [...new Set(rows.map((r) => r.category))]
  const shown = rows.filter((r) =>
    (!q || `${r.sku} ${r.name}`.toLowerCase().includes(q.toLowerCase())) &&
    (!category || r.category === category) &&
    (!status || (status === 'alert' ? r.stock_status !== 'OK' : r.stock_status === status)))
  // finished goods valued at wholesale price, ingredients at cost
  const value = rows.reduce((a, r) => a + r.stock_on_hand * (r.is_sellable ? r.sell_price : r.unit_cost), 0)

  return (
    <div>
      <div className="page-header">
        <h1>Stock Tracking</h1>
        <div className="actions inline">
          <Link to="/admin/stock/adjust" className="btn secondary">Stock adjustment</Link>
          <Link to="/admin/stock/holds" className="btn secondary">Stock on hold</Link>
        </div>
      </div>
      <div className="stats">
        <div className="stat"><div className="stat-label">Products</div><div className="stat-value">{rows.length}</div></div>
        <div className="stat"><div className="stat-label">Stock value</div><div className="stat-value">{money(value)}</div></div>
        <div className="stat"><div className="stat-label">Low stock</div><div className="stat-value">{rows.filter((r) => r.stock_status === 'Low').length}</div></div>
        <div className="stat"><div className="stat-label">Out of stock</div><div className="stat-value">{rows.filter((r) => r.stock_status === 'Out').length}</div></div>
      </div>
      <div className="card">
        <div className="toolbar">
          <input placeholder="Search SKU or product…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>{categories.map((c) => <option key={c}>{c}</option>)}
          </select>
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All stock levels</option><option value="alert">Needs attention</option>
            <option value="OK">In stock</option><option value="Low">Low stock</option><option value="Out">Out of stock</option>
          </select>
        </div>
        <p className="muted small table-caption"><strong>Available</strong> = on hand − on hold. Customers can only buy available stock.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>SKU</th><th>Product</th><th>Category</th><th className="num">On hand</th><th className="num">On hold</th><th className="num">Available</th><th className="num">Reorder at</th><th>Level</th><th></th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} className={String(r.id) === focus ? 'focus-row' : ''}>
                  <td>{r.sku}</td><td><strong>{r.name}</strong>{r.size && <div className="muted small">{r.size}</div>}</td><td className="muted">{r.category}</td>
                  <td className="num">{num(r.stock_on_hand)}</td>
                  <td className="num">{r.on_hold ? <Link to={`/admin/stock/holds?product=${r.id}`}>{num(r.on_hold)}</Link> : 0}</td>
                  <td className="num"><strong>{num(r.available)}</strong> <span className="muted small">{r.uom}</span></td>
                  <td className="num">{num(r.reorder_level)}</td>
                  <td><StatusBadge status={r.stock_status} /></td>
                  <td className="row-actions">
                    <Link to={`/admin/stock/adjust?product=${r.id}`}>Adjust</Link>
                    <Link to={`/admin/stock/holds?product=${r.id}`}>Hold</Link>
                    <Link to={`/admin/stock/movements?product_id=${r.id}`}>History</Link>
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
