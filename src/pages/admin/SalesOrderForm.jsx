import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, money } from '../../api.js'

// Admin-entered sale (e.g. phone or walk-in order). Prices come from the product master.
export default function SalesOrderForm() {
  const [customers, setCustomers] = useState([])
  const [stock, setStock] = useState([])
  const [customerId, setCustomerId] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState([{ product_id: '', quantity: 1 }])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/admin/customers').then(setCustomers)
    api.get('/admin/stock').then(setStock)
  }, [])

  const pickCustomer = (id) => {
    setCustomerId(id)
    setAddress(customers.find((c) => String(c.id) === id)?.address || '')
  }
  const product = (id) => stock.find((p) => String(p.id) === String(id))
  const update = (i, patch) => setLines(lines.map((l, n) => (n === i ? { ...l, ...patch } : l)))
  const total = lines.reduce((a, l) => a + (product(l.product_id)?.sell_price || 0) * (Number(l.quantity) || 0), 0)

  const save = async () => {
    setError(''); setBusy(true)
    try {
      const { id } = await api.post('/admin/sales-orders', {
        customer_id: customerId, delivery_address: address, notes,
        lines: lines.filter((l) => l.product_id).map((l) => ({ product_id: Number(l.product_id), quantity: Number(l.quantity) })),
      })
      window.dispatchEvent(new Event('notifications:refresh'))
      navigate(`/admin/sales/${id}`)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="breadcrumb"><Link to="/admin/sales">Sales Orders</Link> / New</div>
          <h1>New Sale</h1>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      <div className="card">
        <div className="grid-form">
          <label>Customer *
            <select value={customerId} onChange={(e) => pickCustomer(e.target.value)}>
              <option value="">— Select customer —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
          </label>
          <label className="span-2">Delivery address
            <input value={address} onChange={(e) => setAddress(e.target.value)} />
          </label>
          <label className="span-2">Notes
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
        </div>
      </div>
      <div className="card">
        <h2>Items</h2>
        <div className="table-wrap">
          <table className="lines">
            <thead><tr><th>Product</th><th className="num">Available</th><th className="num" style={{ width: 110 }}>Qty</th><th className="num">Price</th><th className="num">Amount</th><th></th></tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const p = product(l.product_id)
                const over = p && (Number(l.quantity) > p.available || Number(l.quantity) < p.moq)
                return (
                  <tr key={i}>
                    <td>
                      <select value={l.product_id} onChange={(e) => update(i, { product_id: e.target.value, quantity: product(e.target.value)?.moq || 1 })}>
                        <option value="">— Select product —</option>
                        {stock.filter((s) => s.is_sellable).map((s) => <option key={s.id} value={s.id} disabled={s.available <= 0}>{s.sku} · {s.name}{s.available <= 0 ? ' (out of stock)' : ''}</option>)}
                      </select>
                    </td>
                    <td className="num">{p ? <>{p.available} {p.uom}<div className="muted small">MOQ {p.moq}</div></> : '—'}</td>
                    <td><input type="number" min="1" className={`num ${over ? 'invalid' : ''}`} value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} /></td>
                    <td className="num">{p ? money(p.sell_price) : '—'}</td>
                    <td className="num">{p ? money(p.sell_price * (Number(l.quantity) || 0)) : '—'}</td>
                    <td><button className="icon-btn" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, n) => n !== i))}>✕</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <button className="btn ghost" onClick={() => setLines([...lines, { product_id: '', quantity: 1 }])}>+ Add line</button>
        <div className="totals"><div className="grand"><span>Total <span className="muted small">excl. SST</span></span><span>{money(total)}</span></div></div>
      </div>
      <div className="actions">
        <Link to="/admin/sales" className="btn ghost">Cancel</Link>
        <button className="btn primary" disabled={busy} onClick={save}>Create order</button>
      </div>
    </div>
  )
}
