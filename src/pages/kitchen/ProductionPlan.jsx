import { useEffect, useState, useCallback } from 'react'
import { api, fmtDayLong } from '../../api.js'
import ProductImage from '../../components/ProductImage.jsx'
import Icon from '../../components/Icon.jsx'
import Flash from '../../components/Flash.jsx'

const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const plus = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }

// What to make each day: total quantity per product per production date, across all orders
export default function ProductionPlan() {
  const [from, setFrom] = useState(today())
  const [to, setTo] = useState(plus(today(), 6))
  const [data, setData] = useState(null)
  const [msg, setMsg] = useState(null)
  const [qty, setQty] = useState({})
  const load = useCallback(() => api.get(`/kitchen/production?from=${from}&to=${to}`).then(setData), [from, to])
  useEffect(() => { load() }, [load])

  const record = async (r) => {
    const n = Number(qty[`${r.production_date}|${r.product_id}`] ?? Math.max(r.qty - r.produced, 0))
    setMsg(null)
    try { await api.post('/kitchen/production', { product_id: r.product_id, qty: n, production_date: r.production_date }); setMsg({ ok: true, text: `Recorded ${n} × ${r.name} produced for ${r.production_date}.` }); load() }
    catch (e) { setMsg({ ok: false, text: e.message }) }
  }
  const days = data ? [...new Set(data.rows.map((r) => r.production_date))] : []

  return (
    <div>
      <div className="page-header no-print">
        <h1>Production Plan</h1>
        <div className="actions inline">
          <label className="inline-field">From <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="inline-field">To <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button className="btn ghost" onClick={() => window.print()}><Icon name="Printer" size={18} /> Print</button>
        </div>
      </div>
      <p className="muted no-print">What to make each day, across all orders. Press <strong>Record</strong> when a batch is done so the stock is there for dispatch.</p>
      <Flash msg={msg} className="no-print" />
      {data && days.length === 0 && <div className="card empty">Nothing to produce in this range.</div>}
      {days.map((d) => {
        const rows = data.rows.filter((r) => r.production_date === d)
        return (
          <div key={d} className="card">
            <div className="card-head"><h2>{fmtDayLong(d)}</h2><span className="muted">{rows.reduce((a, r) => a + r.qty, 0)} units · {rows.length} products</span></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th><span className="sr-only">Photo</span></th><th>Product</th><th className="num">To make</th><th className="num">Orders</th><th>For pickup / delivery</th><th className="num">Produced</th><th className="no-print">Record produced</th></tr></thead>
                <tbody>{rows.map((r) => {
                  const k = `${r.production_date}|${r.product_id}`
                  const remaining = Math.max(r.qty - r.produced, 0)
                  return (
                    <tr key={k} className={remaining === 0 ? 'done-row' : ''}>
                      <td style={{ width: 54 }}><ProductImage src={r.image_url} name={r.name} className="thumb" /></td>
                      <td><strong>{r.name}</strong><div className="muted small">{r.sku}{r.size && r.size !== '1pc' ? ` · ${r.size}` : ''}</div></td>
                      <td className="num big">{r.qty} <span className="small muted">{r.uom}</span></td>
                      <td className="num">{r.orders}</td>
                      <td className="small">{r.fulfil_dates.join(', ')}</td>
                      <td className="num">{r.produced}{remaining === 0 && <> <Icon name="CircleCheck" size={16} className="pos" /><span className="sr-only">done</span></>}</td>
                      <td className="no-print"><div className="input-row">
                        <input type="number" min="1" style={{ width: 80 }} value={qty[k] ?? remaining} onChange={(e) => setQty({ ...qty, [k]: e.target.value })} aria-label={`Quantity of ${r.name} produced`} />
                        <button className="btn secondary small" onClick={() => record(r)}>Record</button>
                      </div></td>
                    </tr>
                  )
                })}</tbody>
              </table>
            </div>
          </div>
        )
      })}
    </div>
  )
}
