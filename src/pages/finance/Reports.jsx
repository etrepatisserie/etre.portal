import { useEffect, useState } from 'react'
import { api, downloadFile, money, compactMoney, fmtDay, MONTHS } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import { ColumnChart, ChartCard } from '../../components/charts.jsx'
import { outletLabel } from '../../outlet.js'
import Icon from '../../components/Icon.jsx'

const monthLabel = (ym, long) => (long ? new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : MONTHS[Number(ym.slice(5, 7)) - 1])
const thisMonth = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7)
const lastMonths = (n) => Array.from({ length: n }, (_, i) => { const d = new Date(`${thisMonth()}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - i); return d.toISOString().slice(0, 7) })

// Monthly finance report per company (they file separate SST returns): invoiced incl. SST,
// collected, outstanding, by customer, last 6 months. Follows the company tabs.
function CompanyReport({ c, single }) {
  const [showInv, setShowInv] = useState(false)
  return (
    <section className={`company-block co-${c.code.toLowerCase()}`}>
      <h2 className="company-title"><span className={`outlet-tag outlet-${c.code.toLowerCase()}`}>{outletLabel(c.code)}</span> {c.company_name}
        <span className="muted small"> · Reg. {c.company_reg_no || '—'} · SST {c.sst_reg_no || '—'}</span></h2>
      <div className="stats small">
        <div className="stat"><div className="stat-label">Invoiced</div><div className="stat-value">{money(c.invoiced.total)}</div><div className="stat-sub">{c.invoiced.count} invoice(s)</div></div>
        <div className="stat"><div className="stat-label">SST charged</div><div className="stat-value">{money(c.invoiced.sst)}</div><div className="stat-sub">on {money(c.invoiced.subtotal + c.invoiced.delivery_fee)} (goods + delivery)</div></div>
        {c.credit_notes.count > 0 && <div className="stat"><div className="stat-label">Credit notes</div><div className="stat-value">− {money(c.credit_notes.total)}</div><div className="stat-sub">{c.credit_notes.count} issued · SST − {money(c.credit_notes.sst)} · net SST {money(c.net.sst)}</div></div>}
        <div className="stat"><div className="stat-label">Collected</div><div className="stat-value">{money(c.collected.total)}</div><div className="stat-sub">{c.collected.count} invoice(s) paid in {monthLabel(c.month)}</div></div>
        <div className="stat"><div className="stat-label">Outstanding today</div><div className="stat-value">{money(c.outstanding_now.total)}</div>
          <div className={`stat-sub ${c.outstanding_now.overdue > 0 ? 'neg' : ''}`}>{c.outstanding_now.overdue > 0 ? `${money(c.outstanding_now.overdue)} overdue` : 'nothing overdue'}</div></div>
      </div>
      <div>
        <ChartCard title="Invoiced per month" subtitle="Last 6 months · incl. SST"
          columns={['Month', 'Invoices', 'Invoiced', 'SST', 'Collected']}
          rows={c.trend.map((t) => [monthLabel(t.month, true), t.invoices, money(t.invoiced), money(t.sst), money(t.collected)])}>
          <ColumnChart format={money} axisFormat={compactMoney}
            data={c.trend.map((t) => ({ label: monthLabel(t.month), fullLabel: monthLabel(t.month, true), value: t.invoiced, sub: `${t.invoices} invoices · collected ${money(t.collected)}` }))} />
        </ChartCard>
        <div className="card">
          <h2>By customer · {monthLabel(c.month, true)}</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Customer</th><th>Term</th><th className="num">Invoices</th><th className="num">Invoiced</th><th className="num">Paid</th><th className="num">Unpaid</th></tr></thead>
              <tbody>
                {c.customers.length === 0 && <tr><td colSpan="6" className="empty"><Icon name="Inbox" size={24} className="empty-icon" />No invoices this month.</td></tr>}
                {c.customers.map((x) => <tr key={x.customer_code}><td><strong>{x.customer_name}</strong></td><td><StatusBadge status={x.payment_term} /></td><td className="num">{x.invoices}</td>
                  <td className="num">{money(x.total)}</td><td className="num">{x.paid ? money(x.paid) : '—'}</td><td className={`num ${x.unpaid ? 'neg' : ''}`}>{x.unpaid ? money(x.unpaid) : '—'}</td></tr>)}
              </tbody>
              {c.customers.length > 0 && <tfoot><tr><td colSpan="3"><strong>Total</strong></td><td className="num"><strong>{money(c.invoiced.total)}</strong></td><td colSpan="2" /></tr></tfoot>}
            </table>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Invoices issued · {monthLabel(c.month, true)} ({c.invoices.length})</h2>
          <button className="btn ghost small" onClick={() => setShowInv(!showInv)}>{showInv ? 'Hide' : 'Show'} list</button></div>
        {showInv && (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Invoice</th><th>Issued</th><th>Customer</th><th className="num">Subtotal</th><th className="num">Delivery</th><th className="num">SST</th><th className="num">Total</th><th>Status</th></tr></thead>
              <tbody>{c.invoices.map((i) => <tr key={i.id}><td className="mono">{i.inv_number}</td><td>{fmtDay(i.issue_date)}</td><td>{i.customer_name}</td>
                <td className="num">{money(i.subtotal)}</td><td className="num">{i.delivery_fee ? money(i.delivery_fee) : '—'}</td><td className="num">{money(i.sst_amount)}</td><td className="num">{money(i.total)}</td><td><StatusBadge status={i.payment_status} /></td></tr>)}</tbody>
              <tfoot><tr><td colSpan="3"><strong>Total</strong></td><td className="num">{money(c.invoiced.subtotal)}</td><td className="num">{money(c.invoiced.delivery_fee)}</td><td className="num"><strong>{money(c.invoiced.sst)}</strong></td><td className="num"><strong>{money(c.invoiced.total)}</strong></td><td /></tr></tfoot>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

export default function FinanceReports() {
  const [month, setMonth] = useState(thisMonth())
  const [r, setR] = useState(null)
  const [err, setErr] = useState('')
  useEffect(() => { api.get(`/finance/reports?month=${month}`).then(setR).catch((e) => setErr(e.message)) }, [month])
  const ready = r?.month === month
  const single = r?.companies.length === 1
  const dl = async () => {
    setErr('')
    const tag = single ? r.companies[0].code.toLowerCase() : 'kl-and-ipoh'
    try { await downloadFile(`/finance/reports/download?month=${month}`, `finance-report-${tag}-${month}.xlsx`) } catch (e) { setErr(e.message) }
  }
  return (
    <div>
      <div className="page-header">
        <div><h1>Monthly Report{single ? ` — ${outletLabel(r.companies[0].code)}` : ''}</h1>
          <div className="muted">Each company separately: invoiced, SST, collected and outstanding</div></div>
        <div className="actions inline">
          <select className="month-select" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
            {lastMonths(12).map((m) => <option key={m} value={m}>{monthLabel(m, true)}</option>)}
          </select>
          <button className="btn secondary" onClick={dl} disabled={!r}><Icon name="Download" size={18} /> Excel{single ? '' : ' (one sheet per company)'}</button>
        </div>
      </div>
      {err && <div className="alert error">{err}</div>}
      {!ready ? <p>Loading…</p> : r.companies.map((c) => <CompanyReport key={c.code} c={c} single={single} />)}
    </div>
  )
}
