import { useEffect, useState } from 'react'
import { api, money } from '../../api.js'
import Todo from '../../components/Todo.jsx'
import { outletLabel } from '../../outlet.js'
import { PageSkeleton } from '../../components/Skeleton.jsx'

// One finance login, two companies: each company gets its own to-do and its own month figures.
// "Both companies" shows them side by side — never added together.
function Company({ c, single }) {
  return (
    <section className={`company-block co-${c.code.toLowerCase()}`}>
      {!single && <h2 className="company-title"><span className={`outlet-tag outlet-${c.code.toLowerCase()}`}>{outletLabel(c.code)}</span> {c.company_name}</h2>}
      <p className="section-label">To-do</p>
      <div className="todo">
        <Todo icon="FilePlus2" n={c.to_invoice} tone="blue" what="Orders to invoice" hint="Already with the kitchen" to="/finance/invoices/new" go="Issue invoices" />
        <Todo icon="BadgeCheck" n={c.slips_pending} tone="amber" what="Payment slips to check" hint="Customers can't order until verified" to="/finance/payments" go="Verify" />
        <Todo icon="FileMinus" n={c.credit_notes_to_issue} tone="amber" what="Credit notes to issue" hint="Requested by Admin for complaints" to="/finance/credit-notes" go="Issue" />
        <Todo icon="Wallet" n={c.bills_to_record} tone="gray" what="Supplier bills to record" hint="Goods received, no bill yet" to="/finance/payables?tab=to_record" go="Record" />
        <Todo icon="AlertCircle" n={c.bills_overdue.n} tone="red" what="Supplier bills overdue" hint={money(c.bills_overdue.t)} to="/finance/payables?tab=unpaid" go="Pay" />
        <Todo icon="CalendarClock" n={c.term_requests} tone="amber" what="Credit term requests" hint="Approve or reject" to="/finance/terms" go="Decide" />
        <Todo icon="AlertCircle" n={c.overdue.n} tone="red" what="Overdue invoices" hint={money(c.overdue.t)} to="/finance/aging" go="Aging report" />
      </div>
      <p className="section-label">This month</p>
      <div className="kpis">
        <div className="stat"><div className="stat-label">Outstanding</div><div className="stat-value">{money(c.outstanding.t)}</div><div className="stat-sub">{c.outstanding.n} unpaid invoice{c.outstanding.n === 1 ? '' : 's'} · after credit notes</div></div>
        <div className="stat"><div className="stat-label">Invoiced this month</div><div className="stat-value">{money(c.invoiced_this_month)}</div><div className="stat-sub">incl. SST</div></div>
        <div className="stat"><div className="stat-label">Collected this month</div><div className="stat-value">{money(c.paid_this_month)}</div><div className="stat-sub">payments verified</div></div>
      </div>
    </section>
  )
}

export default function FinanceDashboard() {
  const [d, setD] = useState(null)
  useEffect(() => { api.get('/finance/dashboard').then(setD) }, [])
  if (!d) return <PageSkeleton cards={4} />
  const single = d.companies.length === 1
  return (
    <div>
      <div className="page-header">
        <div><h1>Finance{single ? ` — ${outletLabel(d.companies[0].code)}` : ''}</h1>
          {single && <div className="muted">{d.companies[0].company_name}{d.companies[0].company_reg_no ? ` · ${d.companies[0].company_reg_no}` : ''}</div>}</div>
      </div>
      <div className={single ? '' : 'company-grid'}>
        {d.companies.map((c) => <Company key={c.code} c={c} single={single} />)}
      </div>
    </div>
  )
}
