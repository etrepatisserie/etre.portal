import { useEffect, useState } from 'react'
import { api, money, compactMoney, num } from '../../api.js'
import { ColumnChart, BarList, ChartCard } from '../../components/charts.jsx'

const RANGES = [[3, 'Last 3 months'], [6, 'Last 6 months'], [12, 'Last 12 months']]
const STATUS_ORDER = ['Pending', 'Confirmed', 'Packed', 'Shipped', 'Delivered', 'Cancelled']
const monthLabel = (ym, long) => new Date(`${ym}-01T00:00:00`).toLocaleDateString(undefined, long ? { month: 'long', year: 'numeric' } : { month: 'short' })

export default function Statistics() {
  const [months, setMonths] = useState(6)
  const [d, setD] = useState(null)
  useEffect(() => { api.get(`/admin/statistics?months=${months}`).then(setD) }, [months])

  return (
    <div>
      <div className="page-header">
        <h1>Statistics</h1>
        {/* filters live in one row above all charts */}
        <div className="segmented">
          {RANGES.map(([m, label]) => (
            <button key={m} className={months === m ? 'on' : ''} onClick={() => setMonths(m)}>{label}</button>
          ))}
        </div>
      </div>
      {!d ? <p>Loading…</p> : <>
        <div className="stats">
          <div className="stat"><div className="stat-label">Revenue</div><div className="stat-value">{compactMoney(d.totals.revenue)}</div><div className="stat-sub">{money(d.totals.revenue)}</div></div>
          <div className="stat"><div className="stat-label">Orders</div><div className="stat-value">{num(d.totals.orders)}</div><div className="stat-sub">excluding cancelled</div></div>
          <div className="stat"><div className="stat-label">Average order value</div><div className="stat-value">{money(d.totals.aov)}</div></div>
          <div className="stat"><div className="stat-label">Units sold</div><div className="stat-value">{num(d.totals.units)}</div></div>
        </div>

        <ChartCard title="Revenue by month" subtitle="Current month is month-to-date"
          columns={['Month', 'Revenue', 'Orders']}
          rows={d.monthly.map((m) => [monthLabel(m.month, true), money(m.revenue), m.orders])}>
          <ColumnChart highlightLast format={money} axisFormat={compactMoney}
            data={d.monthly.map((m) => ({ label: monthLabel(m.month), fullLabel: monthLabel(m.month, true), value: m.revenue, sub: `${m.orders} orders` }))} />
        </ChartCard>

        <div className="two-col">
          <ChartCard title="Top products by revenue" columns={['Product', 'Revenue', 'Units']}
            rows={d.topProducts.map((p) => [p.name, money(p.revenue), num(p.units)])}>
            <BarList format={compactMoney} data={d.topProducts.map((p) => ({ label: p.name, value: p.revenue, sub: `${money(p.revenue)} · ${num(p.units)} units` }))} />
          </ChartCard>
          <ChartCard title="Top customers by revenue" columns={['Customer', 'Revenue', 'Orders']}
            rows={d.topCustomers.map((c) => [c.name, money(c.revenue), c.orders])}>
            <BarList format={compactMoney} data={d.topCustomers.map((c) => ({ label: c.name, value: c.revenue, sub: `${money(c.revenue)} · ${c.orders} orders` }))} />
          </ChartCard>
        </div>

        <div className="two-col">
          <ChartCard title="Orders per month" columns={['Month', 'Orders']} rows={d.monthly.map((m) => [monthLabel(m.month, true), m.orders])}>
            <ColumnChart height={200} highlightLast format={(v) => `${v} orders`} axisFormat={(v) => String(Math.round(v))}
              data={d.monthly.map((m) => ({ label: monthLabel(m.month), fullLabel: monthLabel(m.month, true), value: m.orders }))} />
          </ChartCard>
          <ChartCard title="Orders by status" subtitle="All orders placed in the period" columns={['Status', 'Orders']}
            rows={STATUS_ORDER.map((s) => [s, d.byStatus.find((b) => b.status === s)?.count || 0])}>
            <BarList format={(v) => String(v)}
              data={STATUS_ORDER.map((s) => ({ label: s, value: d.byStatus.find((b) => b.status === s)?.count || 0 }))} />
          </ChartCard>
        </div>
      </>}
    </div>
  )
}
