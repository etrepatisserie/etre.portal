import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, money, fmtDay } from '../../api.js'
import Totals, { previewTotals } from '../../components/Totals.jsx'
import Icon from '../../components/Icon.jsx'

// Admin-entered sale (e.g. phone order). Same rules as the customer checkout: MOQ, dates, unpaid-invoice block.
export default function SalesOrderForm() {
  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [info, setInfo] = useState(null)
  const [customerId, setCustomerId] = useState('')
  const [method, setMethod] = useState('delivery')
  const [address, setAddress] = useState('')
  const [areaOk, setAreaOk] = useState(false)
  const [date, setDate] = useState('')
  const [slot, setSlot] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState([{ product_id: '', quantity: 1 }])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/admin/customers').then(setCustomers)
    api.get('/admin/products').then((p) => setProducts(p.filter((x) => x.is_sellable)))
  }, [])
  useEffect(() => {
    api.get(`/admin/checkout-info${customerId ? `?customer_id=${customerId}` : ''}`).then((i) => { setInfo(i); setDate((d) => d || i.window.dates[0]) })
  }, [customerId])
  useEffect(() => { if (info) setSlot((method === 'pickup' ? info.pickup_slots : info.delivery_slots)[0]) }, [method, info])

  const pickCustomer = (id) => { setCustomerId(id); const c = customers.find((x) => String(x.id) === id); setAddress(c?.address || c?.billing_address || '') }
  const product = (id) => products.find((p) => String(p.id) === String(id))
  const update = (i, patch) => setLines(lines.map((l, n) => (n === i ? { ...l, ...patch } : l)))
  const subtotal = lines.reduce((a, l) => a + (product(l.product_id)?.sell_price || 0) * (Number(l.quantity) || 0), 0)
  const t = info ? previewTotals(subtotal, method, info) : null

  const save = async () => {
    setError(''); setBusy(true)
    try {
      const { id } = await api.post('/admin/sales-orders', {
        customer_id: customerId, method, fulfil_date: date, time_slot: slot, notes,
        area_confirmed: method === 'delivery' ? areaOk : false, delivery_address: address,
        lines: lines.filter((l) => l.product_id).map((l) => ({ product_id: Number(l.product_id), quantity: Number(l.quantity) })),
      })
      window.dispatchEvent(new Event('notifications:refresh'))
      navigate(`/admin/sales/${id}`)
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="page-header">
        <div><div className="breadcrumb"><Link to="/admin/sales">Sales Orders</Link> / New</div><h1>New Sale</h1></div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {info?.blocking_invoices?.length > 0 && (
        <div className="alert error">This customer has unpaid invoices ({info.blocking_invoices.map((b) => b.inv_number).join(', ')}) — new orders are blocked until they are paid.</div>
      )}
      <div className="card">
        <div className="grid-form">
          <label>Customer *
            <select value={customerId} onChange={(e) => pickCustomer(e.target.value)}>
              <option value="">— Select customer —</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.name}</option>)}
            </select>
          </label>
          <label>Method
            <select value={method} onChange={(e) => setMethod(e.target.value)}><option value="delivery">Delivery</option><option value="pickup">Pickup</option></select>
          </label>
          <label>{method === 'pickup' ? 'Pickup' : 'Delivery'} date
            <select value={date} onChange={(e) => setDate(e.target.value)}>{info?.window.dates.map((d) => <option key={d} value={d}>{fmtDay(d)}</option>)}</select>
          </label>
          <label>Time slot
            <select value={slot} onChange={(e) => setSlot(e.target.value)}>{info && (method === 'pickup' ? info.pickup_slots : info.delivery_slots).map((s) => <option key={s}>{s}</option>)}</select>
          </label>
          {method === 'delivery' && <>
            <label className="span-2">Delivery address<input value={address} onChange={(e) => setAddress(e.target.value)} /></label>
            <p className="muted small span-2">Defaults to the customer's registered business address. Change it only if the customer asked for a different address — then tick below.</p>
            <label className="check span-2"><input type="checkbox" checked={areaOk} onChange={(e) => setAreaOk(e.target.checked)} /> <span>Customer confirmed the different address is within {info?.delivery_area}</span></label>
          </>}
          <label className="span-2">Notes<input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        </div>
        {info && <ul className="date-why">{info.window.explanation.map((x) => <li key={x}>{x}</li>)}</ul>}
      </div>
      <div className="card">
        <h2>Items</h2>
        <div className="table-wrap">
          <table className="lines">
            <thead><tr><th>Product</th><th className="num" style={{ width: 110 }}>Qty</th><th className="num">Price</th><th className="num">Amount</th><th></th></tr></thead>
            <tbody>
              {lines.map((l, i) => {
                const p = product(l.product_id)
                const bad = p && Number(l.quantity) < p.moq
                return (
                  <tr key={i}>
                    <td>
                      <select value={l.product_id} onChange={(e) => update(i, { product_id: e.target.value, quantity: product(e.target.value)?.moq || 1 })}>
                        <option value="">— Select product —</option>
                        {products.map((s) => <option key={s.id} value={s.id} disabled={!s.is_available}>{s.sku} · {s.name}{!s.is_available ? ' (unavailable)' : ''}</option>)}
                      </select>
                      {p && <div className="muted small">MOQ {p.moq} {p.uom}</div>}
                    </td>
                    <td><input type="number" min="1" className={`num ${bad ? 'invalid' : ''}`} value={l.quantity} onChange={(e) => update(i, { quantity: e.target.value })} /></td>
                    <td className="num">{p ? money(p.sell_price) : '—'}</td>
                    <td className="num">{p ? money(p.sell_price * (Number(l.quantity) || 0)) : '—'}</td>
                    <td><button className="icon-btn" disabled={lines.length === 1} onClick={() => setLines(lines.filter((_, n) => n !== i))} aria-label="Remove line" title="Remove line"><Icon name="Trash2" size={16} /></button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <button className="btn ghost" onClick={() => setLines([...lines, { product_id: '', quantity: 1 }])}><Icon name="Plus" size={18} /> Add line</button>
        {t && <Totals t={t} method={method} hint={t.to_free > 0 ? `Add ${money(t.to_free)} more for free delivery.` : null} />}
      </div>
      <div className="actions">
        <Link to="/admin/sales" className="btn ghost">Cancel</Link>
        <button className="btn primary" disabled={busy || !customerId} onClick={save}>Create order</button>
      </div>
    </div>
  )
}
