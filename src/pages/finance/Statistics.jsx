import { useEffect, useState } from 'react'
import { api, money, compactMoney } from '../../api.js'
import { ColumnChart, GroupedColumnChart, BarList, ChartCard } from '../../components/charts.jsx'
import { outletLabel } from '../../outlet.js'
import Icon from '../../components/Icon.jsx'

// Finance analytics per company. KL and Ipoh are separate books: "Both" shows each company's
// own charts one after the other — figures are never added together.
const RANGES = [[3, 'Last 3 months'], [6, 'Last 6 months'], [12, 'Last 12 months']]
const TERM = { COD: 'COD', NET14: '14-day term', NET15: '15-day term', NET30: '30-day term' }
const monthLabel = (ym, long) => new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-GB', long ? { month: 'long', year: 'numeric' } : { month: 'short' })
const days = (n) => (n == null ? '—' : `${Math.round(n)} d`)
const pct = (n) => (n == null ? '—' : `${Math.round(n)}%`)

function Company({ c, single }) {
  const t = c.totals
  const partial = (m) => (m === c.current_month ? ' (month to date)' : '')
  const months = c.monthly.map((m) => ({ ...m, label: monthLabel(m.month), fullLabel: monthLabel(m.month, true) + partial(m.month) }))
  const hasSpeed = months.some((m) => m.paid_count > 0)
  const hasCn = months.some((m) => m.credit_notes > 0)
  return (
    <section className="stats-company">
      {!single && <h2 className="company-title"><span className={`outlet-tag outlet-${c.code.toLowerCase()}`}>{outletLabel(c.code)}</span> {c.company_name}</h2>}
      <div className="stats">
        <div className="stat"><div className="stat-label">Invoiced</div><div className="stat-value">{compactMoney(t.invoiced)}</div><div className="stat-sub">{t.invoices} invoice{t.invoices === 1 ? '' : 's'} · avg {money(t.avg_invoice)}</div></div>
        <div className="stat"><div className="stat-label">Collected</div><div className="stat-value">{compactMoney(t.collected)}</div><div className="stat-sub">{money(t.collected)}</div></div>
        <div className="stat"><div className="stat-label">Outstanding now</div><div className="stat-value">{compactMoney(t.outstanding)}</div><div className={`stat-sub ${t.overdue > 0 ? 'neg' : ''}`}>{money(t.overdue)} overdue</div></div>
        <div className="stat"><div className="stat-label">Avg days to pay</div><div className="stat-value">{days(t.avg_days_to_pay)}</div><div className="stat-sub">{t.credit_paid_count ? `credit-term invoices · ${pct(t.on_time_rate)} on time` : 'no credit-term payments yet'}</div></div>
        <div className="stat"><div className="stat-label">Credit notes</div><div className="stat-value">{compactMoney(t.credit_notes)}</div><div className="stat-sub">SST invoiced {money(t.sst)}</div></div>
      </div>

      <ChartCard title="Invoiced vs collected" subtitle={`By month, RM incl. SST${months.length ? ` · ${monthLabel(c.current_month)} is month to date` : ''}`}
        columns={['Month', 'Invoices', 'Invoiced', 'Collected']} rows={months.map((m) => [m.fullLabel, m.invoices, money(m.invoiced), money(m.collected)])}>
        <GroupedColumnChart data={months.map((m) => ({ label: m.label, fullLabel: m.fullLabel, values: [m.invoiced, m.collected], sub: `${m.invoices} invoice${m.invoices === 1 ? '' : 's'} issued` }))}
          series={[{ name: 'Invoiced' }, { name: 'Collected' }]} format={money} axisFormat={compactMoney} highlightLast />
      </ChartCard>

      <div className="chart-grid">
        <ChartCard title="Outstanding by age" subtitle={`Unpaid today, after credit notes · ${money(t.outstanding)}`}
          columns={['Age', 'Invoices', 'Amount']} rows={c.aging.map((a) => [a.label, a.count, money(a.value)])}>
          <ColumnChart data={c.aging.map((a) => ({ label: a.label.replace(' days', 'd'), fullLabel: a.label, value: a.value, sub: `${a.count} invoice(s)` }))} format={money} axisFormat={compactMoney} height={220} />
        </ChartCard>
        <ChartCard title="Who owes the most" subtitle="Outstanding today, by customer"
          columns={['Customer', 'Invoices', 'Outstanding']} rows={c.outstanding_customers.map((x) => [x.label, x.count, money(x.value)])}>
          {c.outstanding_customers.length ? <BarList data={c.outstanding_customers.map((x) => ({ ...x, sub: `${x.count} unpaid invoice(s)` }))} format={compactMoney} /> : <div className="empty"><Icon name="CircleCheck" size={24} className="empty-icon" />Nothing outstanding.</div>}
        </ChartCard>
        <ChartCard title="Average days to pay" subtitle="Credit-term invoices, by month paid (issue → paid)"
          columns={['Month', 'Paid', 'Avg days', 'On time']} rows={months.map((m) => [m.fullLabel, m.paid_count, days(m.avg_days_to_pay), pct(m.on_time_rate)])}>
          {hasSpeed ? <ColumnChart data={months.map((m) => ({ label: m.label, fullLabel: m.fullLabel, value: m.avg_days_to_pay, sub: m.paid_count ? `${m.paid_count} paid · ${pct(m.on_time_rate)} on time` : 'No credit-term payments' }))}
            format={(v) => `${v} days`} axisFormat={(v) => `${v}d`} height={220} highlightLast /> : <div className="empty"><Icon name="BarChart3" size={24} className="empty-icon" />No credit-term payments in this period.</div>}
        </ChartCard>
        <ChartCard title="Paid on time" subtitle="Share of credit-term invoices paid by their due date"
          columns={['Month', 'Paid', 'On time']} rows={months.map((m) => [m.fullLabel, m.paid_count, pct(m.on_time_rate)])}>
          {hasSpeed ? <ColumnChart data={months.map((m) => ({ label: m.label, fullLabel: m.fullLabel, value: m.on_time_rate, sub: m.paid_count ? `${m.paid_count} credit-term invoice(s) paid` : 'No credit-term payments' }))}
            format={pct} axisFormat={pct} height={220} highlightLast /> : <div className="empty"><Icon name="BarChart3" size={24} className="empty-icon" />No credit-term payments in this period.</div>}
        </ChartCard>
        <ChartCard title="Top customers" subtitle="Invoiced in the period, RM incl. SST"
          columns={['Customer', 'Invoiced']} rows={c.top_customers.map((x) => [x.label, money(x.value)])}>
          <BarList data={c.top_customers.map((x) => ({ ...x, sub: money(x.value) }))} format={compactMoney} />
        </ChartCard>
        <ChartCard title="Sales by payment term" subtitle="Invoiced in the period"
          columns={['Term', 'Invoiced']} rows={c.by_term.map((x) => [TERM[x.label] || x.label, money(x.value)])}>
          <BarList data={c.by_term.map((x) => ({ label: TERM[x.label] || x.label, value: x.value, sub: `${Math.round((x.value / (t.invoiced || 1)) * 100)}% of invoiced` }))} format={compactMoney} />
        </ChartCard>
        {hasCn && (
          <ChartCard title="Credit notes issued" subtitle="By month, RM incl. SST"
            columns={['Month', 'Credit notes']} rows={months.map((m) => [m.fullLabel, money(m.credit_notes)])}>
            <ColumnChart data={months.map((m) => ({ label: m.label, fullLabel: m.fullLabel, value: m.credit_notes }))} format={money} axisFormat={compactMoney} height={220} />
          </ChartCard>
        )}
      </div>
    </section>
  )
}

export default function FinanceStatistics() {
  const [months, setMonths] = useState(6)
  const [d, setD] = useState(null)
  useEffect(() => { api.get(`/finance/statistics?months=${months}`).then(setD) }, [months])
  const ready = d?.months === months
  const single = d?.companies.length === 1
  return (
    <div>
      <div className="page-header">
        <div><h1>Statistics{ready && single ? ` — ${outletLabel(d.companies[0].code)}` : ''}</h1>
          <div className="muted">Sales, collections and payment behaviour. Each company is shown separately — never added together.</div></div>
        <div className="segmented">
          {RANGES.map(([m, label]) => <button key={m} className={months === m ? 'on' : ''} onClick={() => setMonths(m)}>{label}</button>)}
        </div>
      </div>
      {!ready ? <p>Loading…</p> : d.companies.map((c) => <Company key={c.code} c={c} single={single} />)}
    </div>
  )
}
