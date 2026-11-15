import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, money, MONTHS } from '../../api.js'
import { GroupedColumnChart, ChartCard } from '../../components/charts.jsx'
import { outletLabel } from '../../outlet.js'

// Cash conversion cycle per company: how many days cash is tied up between paying suppliers and collecting from customers.
//   CCC = DIO (days stock is held) + DSO (days to collect from customers) − DPO (days to pay suppliers)
const RANGES = [[3, 'Last 3 months'], [6, 'Last 6 months'], [12, 'Last 12 months']]
const monthLabel = (ym, long) => (long ? new Date(`${ym}-01T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : MONTHS[Number(ym.slice(5, 7)) - 1])
const WHY = { DIO: 'no stock used', DSO: 'no invoices', DPO: 'no supplier bills dated this month' }
const d1 = (n) => (n == null ? '—' : `${Math.round(n)}`)

const PARTS = {
  DIO: { name: 'Days inventory', sign: '+', what: 'How long ingredients and packaging sit in stock before they are used.',
    need: <>Needs stock coming in (received purchase orders) and going out (stock adjustments / stocktakes in <em>Admin → Inventory</em>).</> },
  DSO: { name: 'Days to collect', sign: '+', what: 'How long customers take to pay, from invoice to payment.', need: 'Needs invoices issued in the period.' },
  DPO: { name: 'Days to pay suppliers', sign: '−', what: 'How long you take to pay supplier bills. Paying later frees up cash.',
    need: <>Needs supplier bills — record them in <Link to="/finance/payables">Payables</Link>.</> },
}

function Part({ k, value, inputs }) {
  const p = PARTS[k]
  return (
    <div className={`ccc-part ${value == null ? 'missing' : ''}`}>
      <div className="ccc-sign" aria-hidden="true">{p.sign}</div>
      <div className="stat-label">{k} · {p.name}</div>
      <div className="ccc-value">{value == null ? 'Not enough data' : <>{d1(value)} <small>days</small></>}</div>
      <div className="small muted">{value == null ? p.need : p.what}</div>
      {value != null && <div className="ccc-inputs small">{inputs}</div>}
    </div>
  )
}

function Company({ c, single, months }) {
  const o = c.overall
  const rows = c.monthly.map((m) => ({ ...m, label: monthLabel(m.month), fullLabel: monthLabel(m.month, true) + (m.partial ? ' (to date)' : '') }))
  const usable = rows.filter((m) => m.dio != null || m.dso != null || m.dpo != null)
  return (
    <section className="stats-company">
      {!single && <h2 className="company-title"><span className={`outlet-tag outlet-${c.code.toLowerCase()}`}>{outletLabel(c.code)}</span> {c.company_name}</h2>}
      <div className="card ccc-hero">
        <div className="ccc-total">
          <div className="stat-label">Cash conversion cycle · last {months} months</div>
          <div className="ccc-big">{o.ccc == null ? '—' : <>{d1(o.ccc)} <small>days</small></>}</div>
          <div className="small muted">{o.ccc == null
            ? `Can't be worked out yet: ${o.missing.join(' and ')} missing (see below).`
            : o.ccc < 0 ? 'Negative: customers pay you before you pay suppliers. Cash comes in first.'
              : `On average, cash is tied up for ${d1(o.ccc)} days between paying for ingredients and getting paid by customers. Lower is better.`}</div>
        </div>
        <div className="ccc-parts">
          <Part k="DIO" value={o.dio} inputs={<>Avg stock {money(o.avg_inventory)} · used {money(o.cogs)}</>} />
          <Part k="DSO" value={o.dso} inputs={<>Avg owed by customers {money(o.avg_receivables)} · sales {money(o.sales)}</>} />
          <Part k="DPO" value={o.dpo} inputs={<>Avg owed to suppliers {money(o.avg_payables)} · purchases {money(o.purchases)}</>} />
        </div>
      </div>

      {usable.length > 0 && (
        <ChartCard title="Cycle by month" subtitle="Days · CCC = DIO + DSO − DPO (shown below each month)"
          columns={['Month', 'DIO', 'DSO', 'DPO', 'CCC', 'Sales', 'Used (cost)', 'Purchases']}
          rows={rows.map((m) => [m.fullLabel, d1(m.dio), d1(m.dso), d1(m.dpo), d1(m.ccc), money(m.sales), money(m.cogs), money(m.purchases)])}>
          <GroupedColumnChart data={rows.map((m) => ({ label: m.label, fullLabel: m.fullLabel, values: [m.dio, m.dso, m.dpo], sub: m.ccc == null ? `CCC: not enough data — ${m.missing.map((k) => WHY[k]).join('; ')}` : `CCC: ${d1(m.ccc)} days` }))}
            series={[{ name: 'DIO · days inventory' }, { name: 'DSO · days to collect' }, { name: 'DPO · days to pay' }]} format={(v) => `${Math.round(v)} days`} axisFormat={(v) => `${v}d`} highlightLast />
          <div className="ccc-strip" style={{ gridTemplateColumns: `repeat(${rows.length}, 1fr)` }}>
            {rows.map((m) => <div key={m.month}><span className="muted">CCC</span> <strong className={m.ccc < 0 ? 'pos' : ''}>{d1(m.ccc)}</strong></div>)}
          </div>
        </ChartCard>
      )}
    </section>
  )
}

export default function CashCycle() {
  const [months, setMonths] = useState(6)
  const [d, setD] = useState(null)
  useEffect(() => { api.get(`/finance/cash-cycle?months=${months}`).then(setD) }, [months])
  const ready = d?.months === months
  const single = d?.companies.length === 1
  return (
    <div>
      <div className="page-header">
        <div><h1>Cash Conversion Cycle{ready && single ? ` — ${outletLabel(d.companies[0].code)}` : ''}</h1>
          <div className="muted">Days between paying suppliers and collecting from customers. Each company separately.</div></div>
        <div className="segmented">{RANGES.map(([m, l]) => <button key={m} className={months === m ? 'on' : ''} onClick={() => setMonths(m)}>{l}</button>)}</div>
      </div>
      {!ready ? <p>Loading…</p> : d.companies.map((c) => <Company key={c.code} c={c} single={single} months={months} />)}
      <details className="card ccc-how">
        <summary>How it is worked out</summary>
        <ul className="small">
          <li><strong>DSO</strong> = average amount customers owe ÷ sales × days in the period (invoices after credit notes).</li>
          <li><strong>DIO</strong> = average stock value ÷ cost of stock used × days. Stock is valued at each ingredient's unit cost; used = opening stock + stock received − closing stock. Finished products have no cost yet, so they are not counted.</li>
          <li><strong>DPO</strong> = average amount owed to suppliers ÷ purchases (supplier bills) × days.</li>
          <li>Averages use the balance at the start, at each month end, and at the end of the period. The current month runs to today.</li>
          <li>Opening stock entered at go-live counts as stock already on hand, not as a purchase.</li>
        </ul>
      </details>
    </div>
  )
}
