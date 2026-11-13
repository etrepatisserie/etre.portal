import { useEffect, useState } from 'react'
import { api, downloadFile, money, fmtDay } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import CustomerFilter, { matchesCustomer } from '../../components/CustomerFilter.jsx'
import { outletLabel } from '../../outlet.js'
import Icon from '../../components/Icon.jsx'

// Outstanding invoices, one section per company (KL and Ipoh keep separate books).
function CompanyAging({ a, code, name, custs, invs, showTitle }) {
  const total = custs.reduce((x, c) => x + c.total, 0)
  return (
    <section className={`company-block co-${code.toLowerCase()}`}>
      {showTitle && <h2 className="company-title"><span className={`outlet-tag outlet-${code.toLowerCase()}`}>{outletLabel(code)}</span> {name} <span className="muted small">· {money(total)} outstanding</span></h2>}
      <div className="card">
        <h2>By customer</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Customer</th><th>Term</th><th className="num">Invoices</th>{a.buckets.map((b) => <th key={b} className="num">{b}</th>)}<th className="num">Total</th></tr></thead>
            <tbody>
              {custs.length === 0 && <tr><td colSpan={a.buckets.length + 4} className="empty"><Icon name="CircleCheck" size={24} className="empty-icon" />Nothing outstanding.</td></tr>}
              {custs.map((c) => (
                <tr key={c.customer_id}>
                  <td><strong>{c.customer_name}</strong></td><td><StatusBadge status={c.payment_term} /></td><td className="num">{c.invoices}</td>
                  {a.buckets.map((b, i) => <td key={b} className={`num ${i > 0 && c.buckets[b] > 0 ? 'neg' : ''}`}>{c.buckets[b] ? money(c.buckets[b]) : '—'}</td>)}
                  <td className="num"><strong>{money(c.total)}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {invs.length > 0 && (
        <div className="card">
          <h2>Invoices</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Invoice</th><th>Customer</th><th>Issued</th><th>Due</th><th className="num">Days overdue</th><th>Bucket</th><th>Status</th><th className="num">Amount</th></tr></thead>
              <tbody>{invs.map((i) => (
                <tr key={i.id}><td className="mono">{i.inv_number}</td><td>{i.customer_name}</td><td>{fmtDay(i.issue_date)}</td><td>{fmtDay(i.due_date)}</td>
                  <td className={`num ${i.days_overdue ? 'neg' : ''}`}>{i.days_overdue || '—'}</td><td>{i.bucket}</td><td><StatusBadge status={i.payment_status} /></td><td className="num">{money(i.total)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  )
}

export default function AgingReport() {
  const [a, setA] = useState(null)
  const [companies, setCompanies] = useState([])
  const [err, setErr] = useState('')
  const [customer, setCustomer] = useState('')
  useEffect(() => {
    api.get('/finance/aging').then(setA)
    api.get('/finance/dashboard').then((d) => setCompanies(d.companies))
  }, [])
  const single = companies.length === 1
  const tag = single ? companies[0].code.toLowerCase() : 'kl-and-ipoh'
  const dl = async (format) => { setErr(''); try { await downloadFile(`/finance/aging/download?format=${format}${customer ? `&customer=${encodeURIComponent(customer)}` : ''}`, `aging-report-${tag}-${a.as_of}.${format}`) } catch (e) { setErr(e.message) } }
  if (!a || !companies.length) return <p>Loading…</p>
  const invs = a.invoices.filter((i) => matchesCustomer(i.customer_name, customer))
  const outletOf = Object.fromEntries(a.invoices.map((i) => [i.customer_id, i.outlet_code]))
  const custs = a.customers.filter((c) => matchesCustomer(c.customer_name, customer))
  const total = custs.reduce((x, c) => x + c.total, 0)

  return (
    <div>
      <div className="page-header">
        <div><h1>Aging Report{single ? ` — ${outletLabel(companies[0].code)}` : ''}</h1><div className="muted">Outstanding invoices as of {fmtDay(a.as_of)}{single ? ` · ${money(total)}` : ''}</div></div>
        <div className="actions inline">
          <button className="btn secondary" onClick={() => dl('xlsx')}><Icon name="Download" size={18} /> Excel{single ? '' : ' (sheets per company)'}</button>
          <button className="btn secondary" onClick={() => dl('csv')}>⬇ CSV</button>
        </div>
      </div>
      <div className="toolbar"><CustomerFilter value={customer} onChange={setCustomer} /></div>
      {err && <div className="alert error">{err}</div>}
      {companies.map((co) => (
        <CompanyAging key={co.code} a={a} code={co.code} name={co.company_name} showTitle={!single}
          custs={custs.filter((c) => outletOf[c.customer_id] === co.code)} invs={invs.filter((i) => i.outlet_code === co.code)} />
      ))}
    </div>
  )
}
