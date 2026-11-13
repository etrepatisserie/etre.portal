import { Fragment, useEffect, useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api, money, fmtDay } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import OutletTag, { useShowOutlet } from '../../components/OutletTag.jsx'
import { outletLabel } from '../../outlet.js'
import Icon from '../../components/Icon.jsx'

// Payables: bills from suppliers for purchase orders the outlet has received.
// Record the bill when it arrives, mark it paid when you transfer — this drives DPO in the cash conversion cycle.
const TODAY = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
const termLabel = (d) => (d === 0 ? 'On receipt' : `${d} days`)

function RecordBill({ po, terms, onDone }) {
  const [f, setF] = useState({ bill_number: '', bill_date: po.received_day || TODAY(), term_days: 30, amount: po.total })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    setError(''); setBusy(true)
    try { await api.post(`/finance/payables/${po.id}/bill`, { ...f, term_days: Number(f.term_days) }); onDone(`Bill ${f.bill_number} recorded for ${po.po_number}.`) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="bill-form">
      <label>Supplier invoice no.<input value={f.bill_number} onChange={set('bill_number')} placeholder="e.g. INV-88812" /></label>
      <label>Bill date<input type="date" value={f.bill_date} max={TODAY()} onChange={set('bill_date')} /></label>
      <label>Term<select value={f.term_days} onChange={set('term_days')}>{terms.map((t) => <option key={t} value={t}>{termLabel(t)}</option>)}</select></label>
      <label>Amount (RM)<input type="number" step="0.01" min="0" value={f.amount} onChange={set('amount')} /></label>
      <button className="btn primary" disabled={busy || !f.bill_number.trim()} onClick={save}>Record bill</button>
      {error && <div className="alert error small">{error}</div>}
    </div>
  )
}

function PayBill({ b, onDone }) {
  const [date, setDate] = useState(TODAY())
  const [ref, setRef] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pay = async () => {
    setError(''); setBusy(true)
    try { await api.post(`/finance/bills/${b.bill_id}/pay`, { paid_date: date, reference: ref }); onDone(`${b.supplier_name} bill ${b.bill_number} marked paid.`) } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  return (
    <div className="input-row">
      <input type="date" value={date} max={TODAY()} min={b.bill_date} onChange={(e) => setDate(e.target.value)} aria-label="Payment date" />
      <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Bank ref (optional)" aria-label="Bank reference" />
      <button className="btn primary small" disabled={busy} onClick={pay}>Mark paid</button>
      {error && <div className="neg small">{error}</div>}
    </div>
  )
}

export default function Payables() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'unpaid'
  const [d, setD] = useState(null)
  const [open, setOpen] = useState(null)
  const [msg, setMsg] = useState('')
  const [soonLimit] = useState(() => new Date(Date.now() + (8 + 7 * 24) * 3600e3).toISOString().slice(0, 10)) // 7 days ahead, Malaysia date
  const showOutlet = useShowOutlet()
  const load = useCallback(() => api.get('/finance/payables').then(setD), [])
  useEffect(() => { load() }, [load])
  const done = (text) => { setMsg(text); setOpen(null); load() }
  if (!d) return <p>Loading…</p>
  // KL and Ipoh are separate books: totals per company, never added together
  const all = [...d.to_record, ...d.unpaid, ...d.paid]
  const companies = [...new Set(all.map((r) => r.outlet_code))].sort((a, b) => (a === 'KL' ? -1 : b === 'KL' ? 1 : a.localeCompare(b)))
  if (!companies.length) companies.push(null)
  const sum = (rows) => Math.round(rows.reduce((x, r) => x + r.amount, 0) * 100) / 100
  const totalsFor = (code) => {
    const mine = (rows) => rows.filter((r) => code == null || r.outlet_code === code)
    const unpaid = mine(d.unpaid), overdue = unpaid.filter((r) => r.overdue)
    return { unpaid: sum(unpaid), unpaidN: unpaid.length, overdue: sum(overdue), overdueN: overdue.length, soon: sum(unpaid.filter((r) => !r.overdue && r.due_date <= soonLimit)), toRecord: mine(d.to_record).length }
  }
  const tabs = [['to_record', 'Bills to record', d.to_record.length], ['unpaid', 'Unpaid', d.unpaid.length], ['paid', 'Paid', d.paid.length]]

  return (
    <div>
      <div className="page-header"><div><h1>Payables</h1><div className="muted">Supplier bills for goods received. Record each bill when it arrives and mark it paid when you transfer.</div></div></div>
      {companies.map((code) => {
        const t = totalsFor(code)
        return (
          <div key={code || 'one'}>
            {companies.length > 1 && <h2 className="company-title"><span className={`outlet-tag outlet-${code.toLowerCase()}`}>{outletLabel(code)}</span> payables</h2>}
            <div className="stats">
              <div className="stat"><div className="stat-label">Unpaid</div><div className="stat-value">{money(t.unpaid)}</div><div className="stat-sub">{t.unpaidN} bill(s)</div></div>
              <div className="stat"><div className="stat-label">Overdue</div><div className={`stat-value ${t.overdue > 0 ? 'neg' : ''}`}>{money(t.overdue)}</div><div className="stat-sub">{t.overdueN} bill(s) past due</div></div>
              <div className="stat"><div className="stat-label">Due in the next 7 days</div><div className="stat-value">{money(t.soon)}</div></div>
              <div className="stat"><div className="stat-label">Bills to record</div><div className="stat-value">{t.toRecord}</div><div className="stat-sub">goods received, no bill yet</div></div>
            </div>
          </div>
        )
      })}
      {msg && <div className="alert success">{msg}</div>}
      <div className="chips">{tabs.map(([k, l, n]) => <button key={k} className={`chip ${tab === k ? 'on' : ''}`} onClick={() => setParams({ tab: k })}>{l}<span className="chip-count">{n}</span></button>)}</div>

      <div className="card"><div className="table-wrap"><table>
        {tab === 'to_record' && <>
          <thead><tr><th>Purchase order</th><th>Supplier</th><th>Received</th><th className="num">PO total</th><th></th></tr></thead>
          <tbody>
            {d.to_record.length === 0 && <tr><td colSpan="5" className="empty"><Icon name="CircleCheck" size={24} className="empty-icon" />Every received purchase order has its bill.</td></tr>}
            {d.to_record.map((po) => <Fragment key={po.id}>
              <tr>
                <td className="mono">{po.po_number}{showOutlet && <OutletTag code={po.outlet_code} />}</td><td>{po.supplier_name}</td>
                <td>{po.received_day ? fmtDay(po.received_day) : '—'}</td><td className="num">{money(po.total)}</td>
                <td className="row-action">{open === po.id ? <button className="btn ghost small" onClick={() => setOpen(null)}>Close</button> : <button className="btn primary small" onClick={() => setOpen(po.id)}>Record bill</button>}</td>
              </tr>
              {open === po.id && <tr className="form-row"><td colSpan="5"><RecordBill po={po} terms={d.terms} onDone={done} /></td></tr>}
            </Fragment>)}
          </tbody>
        </>}
        {tab === 'unpaid' && <>
          <thead><tr><th>Supplier</th><th>Bill</th><th>Bill date</th><th>Due</th><th className="num">Amount</th><th>Pay</th></tr></thead>
          <tbody>
            {d.unpaid.length === 0 && <tr><td colSpan="6" className="empty"><Icon name="CircleCheck" size={24} className="empty-icon" />No unpaid supplier bills.</td></tr>}
            {d.unpaid.map((b) => (
              <tr key={b.bill_id}>
                <td>{b.supplier_name}{showOutlet && <OutletTag code={b.outlet_code} />}</td>
                <td className="mono">{b.bill_number}<div className="muted small">{b.po_number} · {termLabel(b.term_days)}</div></td>
                <td>{fmtDay(b.bill_date)}</td>
                <td className={b.overdue ? 'neg' : ''}>{fmtDay(b.due_date)}{b.overdue && <div className="small">{b.days_overdue} day(s) overdue</div>}</td>
                <td className="num">{money(b.amount)}</td>
                <td>{open === b.bill_id ? <PayBill b={b} onDone={done} /> : <button className="btn secondary small" onClick={() => setOpen(b.bill_id)}>Pay…</button>}</td>
              </tr>
            ))}
          </tbody>
        </>}
        {tab === 'paid' && <>
          <thead><tr><th>Supplier</th><th>Bill</th><th>Bill date</th><th>Due</th><th>Paid</th><th className="num">Amount</th></tr></thead>
          <tbody>
            {d.paid.length === 0 && <tr><td colSpan="6" className="empty"><Icon name="Inbox" size={24} className="empty-icon" />No paid bills yet.</td></tr>}
            {d.paid.map((b) => (
              <tr key={b.bill_id}>
                <td>{b.supplier_name}{showOutlet && <OutletTag code={b.outlet_code} />}</td>
                <td className="mono">{b.bill_number}<div className="muted small">{b.po_number}</div></td>
                <td>{fmtDay(b.bill_date)}</td><td>{fmtDay(b.due_date)}</td>
                <td>{fmtDay(b.paid_date)} <StatusBadge status={b.paid_date <= b.due_date ? 'Paid' : 'Overdue'} label={b.paid_date <= b.due_date ? 'On time' : 'Late'} tone={b.paid_date <= b.due_date ? 'green' : 'amber'} />{b.paid_reference && <div className="muted small">{b.paid_reference}</div>}</td>
                <td className="num">{money(b.amount)}</td>
              </tr>
            ))}
          </tbody>
        </>}
      </table></div></div>
    </div>
  )
}
