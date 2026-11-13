import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, money, fmtDay } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import CustomerFilter, { matchesCustomer } from '../../components/CustomerFilter.jsx'
import OutletTag, { useShowOutlet } from '../../components/OutletTag.jsx'
import FileLink from '../../components/FileLink.jsx'
import Icon from '../../components/Icon.jsx'

const FILTERS = ['', 'Outstanding', 'Unpaid', 'Slip Uploaded', 'Rejected', 'Paid']

export default function Invoices() {
  const [params, setParams] = useSearchParams()
  const status = params.get('payment_status') || ''
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [customer, setCustomer] = useState('')
  const showOutlet = useShowOutlet()
  useEffect(() => {
    const p = new URLSearchParams(); if (status) p.set('payment_status', status); if (q) p.set('q', q)
    api.get(`/finance/invoices?${p}`).then(setRows)
  }, [status, q])
  const shown = rows.filter((i) => matchesCustomer(i.customer_name, customer))
  const today = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)

  return (
    <div>
      <div className="page-header"><h1>Invoices</h1></div>
      <div className="card">
        <div className="toolbar">
          <CustomerFilter value={customer} onChange={setCustomer} />
          <label className="search-box" style={{ maxWidth: 240 }}><Icon name="Search" size={16} /><input aria-label="Search INV or order no." placeholder="Search INV or order no.…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <div className="chips inline">{FILTERS.map((f) => <button key={f} className={`chip ${status === f ? 'on' : ''}`} onClick={() => setParams(f ? { payment_status: f } : {})}>{f || 'All'}</button>)}</div>
        </div>
        <div className="muted small table-caption">{shown.length} invoices · {money(shown.reduce((a, r) => a + r.total, 0))}</div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Invoice</th><th>Customer</th><th>Order</th><th>Issued</th><th>Due</th><th>Payment</th><th className="num">Amount</th><th>Files</th></tr></thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id}>
                  <td className="mono">{i.inv_number}{showOutlet && <OutletTag code={i.outlet_code} />}<div className="muted small">{i.do_number}{i.source === 'uploaded' ? ' · uploaded' : ''}</div></td>
                  <td>{i.customer_name} <StatusBadge status={i.payment_term} /></td><td>{i.so_number}</td>
                  <td>{fmtDay(i.issue_date)}</td>
                  <td className={i.payment_status !== 'Paid' && i.due_date < today ? 'neg' : ''}>{fmtDay(i.due_date)}{i.payment_status !== 'Paid' && i.due_date < today ? ' · overdue' : ''}</td>
                  <td><StatusBadge status={i.payment_status} /></td><td className="num">{money(i.total)}{i.credited > 0 && <div className="small muted">− {money(i.credited)} credit<br /><strong>{money(i.balance)}</strong> net</div>}</td>
                  <td className="row-actions"><FileLink url={`/documents/invoices/${i.id}/invoice`}>INV</FileLink><FileLink url={`/documents/invoices/${i.id}/do`}>DO</FileLink><Link to={`/finance/credit-notes?invoice=${i.id}`} title="Raise a credit note on this invoice">CN</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
