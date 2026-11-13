import { useEffect, useState, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useNeedsOutlet } from '../../components/OutletField.jsx'
import { api, fmtDateTime } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import Icon from '../../components/Icon.jsx'
import Flash from '../../components/Flash.jsx'
import { useConfirm, useToast } from '../../feedback.js'

// Stock on hold: reserved by open sales orders (automatic) or by staff (manual)
export default function StockHolds() {
  const confirm = useConfirm()
  const toast = useToast()
  const needsOutlet = useNeedsOutlet()
  const [params] = useSearchParams()
  const productFilter = params.get('product') || ''
  const [tab, setTab] = useState('Active')
  const [holds, setHolds] = useState([])
  const [stock, setStock] = useState([])
  const [customers, setCustomers] = useState([])
  const [form, setForm] = useState({ product_id: productFilter, qty: '', reason: '', customer_id: '' })
  const [msg, setMsg] = useState(null)

  const load = useCallback(() => {
    api.get(`/admin/stock/holds?status=${tab}`).then(setHolds)
    api.get('/admin/stock').then(setStock)
  }, [tab])
  useEffect(() => { load() }, [load])
  useEffect(() => { api.get('/admin/customers').then(setCustomers) }, [])

  const p = stock.find((s) => String(s.id) === String(form.product_id))
  const shown = holds.filter((h) => !productFilter || String(h.product_id) === productFilter)
  const totalHeld = shown.filter((h) => h.status === 'Active').reduce((a, h) => a + h.qty, 0)

  const create = async (e) => {
    e.preventDefault(); setMsg(null)
    try {
      await api.post('/admin/stock/holds', form)
      setMsg({ ok: true, text: `${form.qty} ${p.uom} of ${p.name} placed on hold.` })
      setForm({ ...form, qty: '', reason: '' }); load()
    } catch (err) { setMsg({ ok: false, text: err.message }) }
  }
  const release = async (h) => {
    if (!await confirm({ title: `Release ${h.qty} ${h.uom} of ${h.product_name}?`, body: 'It becomes available to sell again.', confirmLabel: 'Release stock' })) return
    try { await api.post(`/admin/stock/holds/${h.id}/release`); toast.success(`${h.qty} ${h.uom} of ${h.product_name} released.`); load() } catch (err) { setMsg({ ok: false, text: err.message }) }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="breadcrumb"><Link to="/admin/stock">Stock Tracking</Link> / On hold</div>
          <h1>Stock on Hold</h1>
        </div>
      </div>

      {needsOutlet ? (
        <div className="card next-step tone-blue"><div className="next-label"><Icon name="Building2" size={16} /> Choose an outlet</div><div className="next-title">Pick KL or Ipoh in the top bar to change stock</div><div className="next-text">Stock is kept separately for each outlet's kitchen.</div></div>
      ) : (
      <form className="card" onSubmit={create}>
        <h2>Place stock on hold</h2>
        <p className="muted small">Held stock stays in the warehouse but can't be sold, e.g. reserved for a customer event or pending a quality check. Sales orders hold stock automatically.</p>
        <Flash msg={msg} />
        <div className="grid-form">
          <label>Product *
            <select value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })} required>
              <option value="">— Select product —</option>
              {stock.map((s) => <option key={s.id} value={s.id}>{s.sku} · {s.name} ({s.available} avail.)</option>)}
            </select>
          </label>
          <label>Quantity *<input type="number" min="1" max={p?.available} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} required /></label>
          <label>For customer (optional)
            <select value={form.customer_id} onChange={(e) => setForm({ ...form, customer_id: e.target.value })}>
              <option value="">— None —</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label>Reason *<input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Quality check" required /></label>
        </div>
        <div className="actions"><button className="btn primary">Place on hold</button></div>
      </form>
      )}

      <div className="card">
        <div className="toolbar">
          <div className="chips inline">
            {['Active', 'Released', 'Fulfilled', 'All'].map((t) => (
              <button key={t} type="button" className={`chip ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>{t}</button>
            ))}
          </div>
          {productFilter && <Link to="/admin/stock/holds" className="chip on"><Icon name="Filter" size={14} /> Filtered to one product <Icon name="X" size={14} /></Link>}
        </div>
        {tab === 'Active' && <div className="muted small table-caption">{shown.length} active holds · {totalHeld} units reserved</div>}
        <div className="table-wrap">
          <table>
            <thead><tr><th>Since</th><th>Product</th><th className="num">Qty</th><th>Reason</th><th>Customer</th><th>Source</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan="8" className="empty"><Icon name="Inbox" size={24} className="empty-icon" />No holds.</td></tr>}
              {shown.map((h) => (
                <tr key={h.id}>
                  <td className="muted small">{fmtDateTime(h.created_at)}</td>
                  <td>{h.product_name}<div className="muted small">{h.sku}</div></td>
                  <td className="num">{h.qty} {h.uom}</td>
                  <td>{h.reason}</td>
                  <td>{h.customer_name || '—'}</td>
                  <td>{h.so_id ? <Link to={`/admin/sales/${h.so_id}`}>{h.so_number}</Link> : <span className="tag">Manual · {h.created_by_name}</span>}</td>
                  <td><StatusBadge status={h.status} tone={h.status === 'Released' ? 'gray' : undefined} /></td>
                  <td>{h.status === 'Active' && !h.so_id && <button className="btn ghost small" onClick={() => release(h)}>Release</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
