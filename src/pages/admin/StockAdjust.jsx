import { useEffect, useState, useCallback } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useNeedsOutlet } from '../../components/OutletField.jsx'
import { api, fmtDateTime } from '../../api.js'
import Icon from '../../components/Icon.jsx'
import Flash from '../../components/Flash.jsx'

const REASONS = ['Stock count correction', 'Damaged goods', 'Expired stock', 'Customer return', 'Sample / internal use', 'Other']

export default function StockAdjust() {
  const needsOutlet = useNeedsOutlet()
  const [params] = useSearchParams()
  const [stock, setStock] = useState([])
  const [recent, setRecent] = useState([])
  const [productId, setProductId] = useState(params.get('product') || '')
  const [direction, setDirection] = useState('add')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState(REASONS[0])
  const [other, setOther] = useState('')
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api.get('/admin/stock').then(setStock)
    api.get('/admin/stock/movements?type=adjustment').then((r) => setRecent(r.slice(0, 15)))
  }, [])
  useEffect(() => { load() }, [load])

  const p = stock.find((s) => String(s.id) === String(productId))
  const n = parseInt(qty, 10) || 0
  const signed = direction === 'add' ? n : -n
  const after = p ? p.stock_on_hand + signed : null

  const save = async (e) => {
    e.preventDefault(); setMsg(null); setBusy(true)
    try {
      const r = await api.post('/admin/stock/adjust', { product_id: productId, qty: signed, reason: reason === 'Other' ? other : reason })
      setMsg({ ok: true, text: `${p.name} adjusted by ${signed > 0 ? '+' : ''}${signed}. New on-hand balance: ${r.balance}.` })
      setQty(''); setOther(''); load()
      window.dispatchEvent(new Event('notifications:refresh'))
    } catch (err) { setMsg({ ok: false, text: err.message }) } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="breadcrumb"><Link to="/admin/stock">Stock Tracking</Link> / Adjustment</div>
          <h1>Stock Adjustment</h1>
        </div>
      </div>
      <div className="two-col">
        {needsOutlet ? (
          <div className="card next-step tone-blue"><div className="next-label"><Icon name="Building2" size={16} /> Choose an outlet</div><div className="next-title">Pick KL or Ipoh in the top bar to change stock</div><div className="next-text">Stock is kept separately for each outlet's kitchen.</div></div>
        ) : (
        <form className="card" onSubmit={save}>
          <h2>Adjust on-hand quantity</h2>
          <Flash msg={msg} />
          <div className="form-stack">
            <label>Product *
              <select value={productId} onChange={(e) => setProductId(e.target.value)} required>
                <option value="">— Select product —</option>
                {stock.map((s) => <option key={s.id} value={s.id}>{s.sku} · {s.name}</option>)}
              </select>
            </label>
            {p && (
              <div className="mini-stats">
                <div><span>On hand</span><strong>{p.stock_on_hand}</strong></div>
                <div><span>On hold</span><strong>{p.on_hold}</strong></div>
                <div><span>Available</span><strong>{p.available}</strong></div>
              </div>
            )}
            <div className="segmented">
              <button type="button" className={direction === 'add' ? 'on' : ''} onClick={() => setDirection('add')}><Icon name="Plus" size={16} /> Add stock</button>
              <button type="button" className={direction === 'remove' ? 'on' : ''} onClick={() => setDirection('remove')}>− Remove stock</button>
            </div>
            <label>Quantity *<input type="number" min="1" value={qty} onChange={(e) => setQty(e.target.value)} required /></label>
            <label>Reason *
              <select value={reason} onChange={(e) => setReason(e.target.value)}>{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
            </label>
            {reason === 'Other' && <label>Describe the reason *<input value={other} onChange={(e) => setOther(e.target.value)} required /></label>}
            {p && n > 0 && (
              <div className={`preview ${after < p.on_hold ? 'bad' : ''}`}>
                On hand: {p.stock_on_hand} → <strong>{after}</strong> {p.uom}
                {after < p.on_hold && <div>Not allowed: {p.on_hold} {p.uom} are on hold.</div>}
              </div>
            )}
          </div>
          <div className="actions"><button className="btn primary" disabled={busy || !p || !n}>Save adjustment</button></div>
        </form>
        )}

        <div className="card">
          <div className="card-head"><h2>Recent adjustments</h2><Link to="/admin/stock/movements?type=adjustment">All →</Link></div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>When</th><th>Product</th><th className="num">Qty</th><th>Reason</th></tr></thead>
              <tbody>
                {recent.map((m) => (
                  <tr key={m.id}>
                    <td className="muted small">{fmtDateTime(m.created_at)}<div>{m.user_name}</div></td>
                    <td>{m.product_name}</td>
                    <td className={`num ${m.qty < 0 ? 'neg' : 'pos'}`}>{m.qty > 0 ? '+' : ''}{m.qty}</td>
                    <td className="small">{m.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
