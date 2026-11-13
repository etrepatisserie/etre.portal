import { useEffect, useState } from 'react'
import { api, downloadFile, fmtDay } from '../../api.js'
import Icon from '../../components/Icon.jsx'

const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const plus = (d, n) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }

export default function KitchenReport() {
  const [from, setFrom] = useState(plus(today(), -6))
  const [to, setTo] = useState(plus(today(), 6))
  const [data, setData] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { api.get(`/kitchen/report?from=${from}&to=${to}`).then(setData).catch((e) => setErr(e.message)) }, [from, to])
  const dl = async (format) => { setErr(''); try { await downloadFile(`/kitchen/report?from=${from}&to=${to}&format=${format}`, `production-summary-${from}-to-${to}.${format}`) } catch (e) { setErr(e.message) } }

  return (
    <div>
      <div className="page-header">
        <h1>Summary Report</h1>
        <div className="actions inline">
          <button className="btn secondary" onClick={() => dl('xlsx')}><Icon name="Download" size={18} /> Excel</button>
          <button className="btn secondary" onClick={() => dl('pdf')}>⬇ PDF</button>
        </div>
      </div>
      <div className="toolbar">
        <label className="inline-field">Production from <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="inline-field">to <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {err && <div className="alert error">{err}</div>}
      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr><th>SKU</th><th>Product</th><th className="num">Total qty</th><th className="num">Orders</th><th>Pickup / delivery dates</th></tr></thead>
            <tbody>
              {data?.rows.length === 0 && <tr><td colSpan="5" className="empty"><Icon name="Inbox" size={24} className="empty-icon" />No production in this range.</td></tr>}
              {data?.rows.map((r) => (
                <tr key={r.sku}><td className="mono">{r.sku}</td><td>{r.name}</td><td className="num"><strong>{r.units}</strong> {r.uom}</td><td className="num">{r.orders}</td><td className="small">{r.fulfil_dates.map(fmtDay).join(', ')}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
