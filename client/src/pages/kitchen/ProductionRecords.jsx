import { useEffect, useState, useCallback } from 'react'
import { api, fmtDateTime } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import Flash from '../../components/Flash.jsx'

const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)

// Record finished goods produced (adds stock) and ingredients used (deducts stock) — linked to the stock module
export default function ProductionRecords() {
  const [products, setProducts] = useState([])
  const [ingredients, setIngredients] = useState([])
  const [log, setLog] = useState([])
  const [prod, setProd] = useState({ product_id: '', qty: '', production_date: today() })
  const [use, setUse] = useState({ product_id: '', qty: '', note: '' })
  const [msg, setMsg] = useState(null)
  const load = useCallback(() => {
    api.get('/kitchen/products').then(setProducts)
    api.get('/kitchen/ingredients').then(setIngredients)
    api.get('/kitchen/movements').then(setLog)
  }, [])
  useEffect(() => { load() }, [load])

  const save = async (e, kind) => {
    e.preventDefault(); setMsg(null)
    try {
      if (kind === 'prod') { const r = await api.post('/kitchen/production', prod); setMsg({ ok: true, text: `Production recorded. On hand now ${r.on_hand}.` }); setProd({ ...prod, qty: '' }) }
      else { const r = await api.post('/kitchen/ingredient-usage', use); setMsg({ ok: true, text: `Usage recorded. On hand now ${r.on_hand}.` }); setUse({ ...use, qty: '', note: '' }) }
      load()
    } catch (err) { setMsg({ ok: false, text: err.message }) }
  }

  return (
    <div>
      <div className="page-header"><h1>Production Records</h1></div>
      <Flash msg={msg} />
      <div className="two-col">
        <form className="card" onSubmit={(e) => save(e, 'prod')}>
          <h2>Finished goods produced</h2>
          <div className="form-stack">
            <label>Product<select value={prod.product_id} onChange={(e) => setProd({ ...prod, product_id: e.target.value })} required>
              <option value="">— Select —</option>{products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}</select></label>
            <label>Quantity produced<input type="number" min="1" value={prod.qty} onChange={(e) => setProd({ ...prod, qty: e.target.value })} required /></label>
            <label>Production date<input type="date" value={prod.production_date} onChange={(e) => setProd({ ...prod, production_date: e.target.value })} required /></label>
          </div>
          <div className="actions"><button className="btn primary">Record production</button></div>
        </form>
        <form className="card" onSubmit={(e) => save(e, 'use')}>
          <h2>Ingredients used</h2>
          <div className="form-stack">
            <label>Ingredient / packaging<select value={use.product_id} onChange={(e) => setUse({ ...use, product_id: e.target.value })} required>
              <option value="">— Select —</option>{ingredients.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.stock_on_hand} {p.uom} on hand)</option>)}</select></label>
            <label>Quantity used<input type="number" min="1" value={use.qty} onChange={(e) => setUse({ ...use, qty: e.target.value })} required /></label>
            <label>Note (optional)<input value={use.note} onChange={(e) => setUse({ ...use, note: e.target.value })} placeholder="e.g. croissant lamination" /></label>
          </div>
          <div className="actions"><button className="btn primary">Record usage</button></div>
        </form>
      </div>

      <div className="two-col">
        <div className="card">
          <h2>Ingredient levels</h2>
          <table>
            <thead><tr><th>Item</th><th className="num">On hand</th><th className="num">Reorder at</th><th></th></tr></thead>
            <tbody>{ingredients.map((p) => <tr key={p.id}><td>{p.name}<div className="muted small">{p.category}</div></td><td className="num">{p.stock_on_hand} {p.uom}</td><td className="num">{p.reorder_level}</td><td><StatusBadge status={p.level} /></td></tr>)}</tbody>
          </table>
        </div>
        <div className="card">
          <h2>Recent records</h2>
          <table>
            <thead><tr><th>When</th><th>Item</th><th className="num">Qty</th><th>By</th></tr></thead>
            <tbody>{log.slice(0, 40).map((m) => (
              <tr key={m.id}><td className="small muted">{fmtDateTime(m.created_at)}</td><td>{m.product_name}<div className="muted small">{m.reason}{m.ref ? ` · ${m.ref}` : ''}</div></td>
                <td className={`num ${m.qty < 0 ? 'neg' : 'pos'}`}>{m.qty > 0 ? '+' : ''}{m.qty}</td><td className="small muted">{m.user_name}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
