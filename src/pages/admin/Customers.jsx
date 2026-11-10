import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, money, fmtDate } from '../../api.js'

export default function Customers() {
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  useEffect(() => { api.get('/admin/customers').then(setRows) }, [])
  const shown = rows.filter((c) => !q || `${c.code} ${c.name} ${c.contact} ${c.login_email}`.toLowerCase().includes(q.toLowerCase()))

  return (
    <div>
      <div className="page-header">
        <h1>Customers</h1>
        <Link to="/admin/customers/new" className="btn primary">+ Add New Customer</Link>
      </div>
      <div className="card">
        <div className="toolbar"><input placeholder="Search customers…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Customer</th><th>Contact</th><th>Portal login</th><th className="num">Orders</th><th className="num">Total spent</th><th>Last order</th><th></th></tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id}>
                  <td>{c.code}</td>
                  <td><strong>{c.name}</strong><div className="muted small">{c.address}</div></td>
                  <td>{c.contact || '—'}<div className="muted small">{c.phone}</div></td>
                  <td className="small">{c.login_email || <span className="muted">no login</span>}</td>
                  <td className="num">{c.order_count}</td><td className="num">{money(c.total_spent)}</td>
                  <td className="muted">{fmtDate(c.last_order)}</td>
                  <td><Link to={`/admin/sales?q=${encodeURIComponent(c.name)}`}>Orders</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
