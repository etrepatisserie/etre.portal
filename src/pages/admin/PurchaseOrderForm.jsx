import { useEffect, useState } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import { api, money, today } from '../../api.js'

const emptyLine = () => ({ product_id: '', description: '', quantity: 1, unit_price: 0 })

export default function PurchaseOrderForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()

  const [suppliers, setSuppliers] = useState([])
  const [products, setProducts] = useState([])
  const [form, setForm] = useState({
    supplier_id: '', order_date: today(), expected_date: '', tax_rate: 0, notes: '',
  })
  const [lines, setLines] = useState([emptyLine()])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [poNumber, setPoNumber] = useState('')

  useEffect(() => {
    api.get('/admin/suppliers').then(setSuppliers)
    api.get('/admin/products').then(setProducts)
    if (isEdit) {
      api.get(`/admin/purchase-orders/${id}`).then((po) => {
        setPoNumber(po.po_number)
        setForm({
          supplier_id: po.supplier_id, order_date: po.order_date, expected_date: po.expected_date || '',
          tax_rate: po.tax_rate, notes: po.notes || '',
        })
        setLines(po.lines.map((l) => ({
          product_id: l.product_id || '', description: l.description, quantity: l.quantity, unit_price: l.unit_price,
        })))
      }).catch((e) => setError(e.message))
    }
  }, [id, isEdit])

  const setField = (k) => (e) => setForm({ ...form, [k]: e.target.value })

  const updateLine = (i, patch) => setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))

  const pickProduct = (i, productId) => {
    const p = products.find((x) => String(x.id) === productId)
    updateLine(i, p
      ? { product_id: p.id, description: p.name, unit_price: p.unit_cost }
      : { product_id: '' })
  }

  const subtotal = lines.reduce((a, l) => a + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0)
  const tax = subtotal * (Number(form.tax_rate) || 0) / 100
  const total = subtotal + tax

  const submit = async (status) => {
    setError(''); setSaving(true)
    try {
      const body = { ...form, supplier_id: Number(form.supplier_id) || null, lines, status }
      const res = isEdit
        ? await api.put(`/admin/purchase-orders/${id}`, body)
        : await api.post('/admin/purchase-orders', body)
      if (isEdit && status === 'Submitted') await api.post(`/admin/purchase-orders/${id}/status`, { status })
      navigate(`/admin/purchasing/orders/${res.id}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="breadcrumb"><Link to="/admin/purchasing/orders">Purchase Orders</Link> / {isEdit ? poNumber : 'New'}</div>
          <h1>{isEdit ? `Edit ${poNumber}` : 'New Purchase Order'}</h1>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="card">
        <h2>Order details</h2>
        <div className="grid-form">
          <label>Supplier *
            <select value={form.supplier_id} onChange={setField('supplier_id')}>
              <option value="">— Select supplier —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}</option>)}
            </select>
          </label>
          <label>Order date *
            <input type="date" value={form.order_date} onChange={setField('order_date')} />
          </label>
          <label>Expected delivery
            <input type="date" value={form.expected_date} onChange={setField('expected_date')} />
          </label>
          <label>Tax rate (%)
            <input type="number" min="0" step="0.01" value={form.tax_rate} onChange={setField('tax_rate')} />
          </label>
          <label className="span-2">Notes
            <textarea rows="2" value={form.notes} onChange={setField('notes')} placeholder="Delivery instructions, terms…" />
          </label>
        </div>
      </div>

      <div className="card">
        <h2>Line items</h2>
        <div className="table-wrap">
          <table className="lines">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th style={{ width: 220 }}>Product</th>
                <th>Description *</th>
                <th style={{ width: 100 }} className="num">Qty *</th>
                <th style={{ width: 120 }} className="num">Unit price</th>
                <th style={{ width: 120 }} className="num">Amount</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>
                    <select value={l.product_id} onChange={(e) => pickProduct(i, e.target.value)}>
                      <option value="">— Free text —</option>
                      {products.map((p) => <option key={p.id} value={p.id}>{p.sku}</option>)}
                    </select>
                  </td>
                  <td><input value={l.description} onChange={(e) => updateLine(i, { description: e.target.value })} /></td>
                  <td><input type="number" min="0" step="any" className="num" value={l.quantity}
                    onChange={(e) => updateLine(i, { quantity: e.target.value })} /></td>
                  <td><input type="number" min="0" step="0.01" className="num" value={l.unit_price}
                    onChange={(e) => updateLine(i, { unit_price: e.target.value })} /></td>
                  <td className="num">{money((Number(l.quantity) || 0) * (Number(l.unit_price) || 0))}</td>
                  <td>
                    <button className="icon-btn" title="Remove line" disabled={lines.length === 1}
                      onClick={() => setLines(lines.filter((_, idx) => idx !== i))}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button className="btn ghost" onClick={() => setLines([...lines, emptyLine()])}>+ Add line</button>

        <div className="totals">
          <div><span>Subtotal</span><span>{money(subtotal)}</span></div>
          <div><span>Tax ({Number(form.tax_rate) || 0}%)</span><span>{money(tax)}</span></div>
          <div className="grand"><span>Total</span><span>{money(total)}</span></div>
        </div>
      </div>

      <div className="actions">
        <Link to="/admin/purchasing/orders" className="btn ghost">Cancel</Link>
        <button className="btn secondary" disabled={saving} onClick={() => submit('Draft')}>Save as draft</button>
        <button className="btn primary" disabled={saving} onClick={() => submit('Submitted')}>Save &amp; submit</button>
      </div>
    </div>
  )
}
