import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { api, money } from '../../api.js'
import BankDetails from '../../components/BankDetails.jsx'

// The order timeline table (MYT). Kept in one place so the page matches the rules the server enforces.
const TIMELINE = [
  ['Monday', 'Wednesday onwards'],
  ['Tuesday', 'Thursday onwards'],
  ['Wednesday', 'Friday onwards'],
  ['Thursday', 'Saturday onwards'],
  ['Friday', 'Sunday onwards (Sunday, Monday or Tuesday)'],
  ['Friday after 1 PM / Saturday / Sunday', 'Treated as a Monday order → Wednesday onwards'],
]

export default function InfoPage() {
  const { page } = useParams()
  const [info, setInfo] = useState(null)
  const [products, setProducts] = useState([])
  useEffect(() => {
    api.get('/customer/checkout-info').then(setInfo).catch(() => {})
    api.get('/customer/products').then(setProducts)
  }, [])

  if (page === 'prices') {
    const cats = [...new Set(products.map((p) => p.category))]
    return (
      <div>
        <div className="page-header"><h1>Suggested Selling Prices</h1></div>
        <p className="muted">Our recommended retail price (RSP) for each product, next to your wholesale price (before SST). Cakes marked "per slice" are sold whole to you.</p>
        {cats.map((c) => (
          <div key={c} className="card">
            <h2>{c}</h2>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Product</th><th>Size</th><th className="num">Your price</th><th className="num">Suggested retail</th></tr></thead>
                <tbody>{products.filter((p) => p.category === c).map((p) => (
                  <tr key={p.id}><td><strong>{p.name}</strong><div className="muted small">{p.sku}</div></td><td>{p.size}</td>
                    <td className="num">{money(p.price)} <span className="muted small">/ {p.uom.toLowerCase()}</span></td>
                    <td className="num"><strong>{p.rsp || '—'}</strong></td></tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (page === 'storage' || page === 'heating') {
    const key = page === 'storage' ? 'storage_notes' : 'heating_notes'
    return (
      <div>
        <div className="page-header"><h1>{page === 'storage' ? 'Storage Guide' : 'Heating Guidelines'}</h1></div>
        <div className="card prose">
          <p className="placeholder-text">[PLACEHOLDER] {page === 'storage'
            ? 'General storage guidance — e.g. how to store viennoiserie, cakes and breads on arrival, chilling and freezing advice.'
            : 'General reheating guidance — e.g. oven temperatures and times for viennoiserie, quiches and breads, and which items are served chilled.'}</p>
        </div>
        <div className="card">
          <h2>By product</h2>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Product</th><th>Category</th>{page === 'storage' && <th>Shelf life</th>}<th>{page === 'storage' ? 'Storage' : 'Heating'}</th></tr></thead>
              <tbody>{products.map((p) => (
                <tr key={p.id}><td><strong>{p.name}</strong><div className="muted small">{p.sku}</div></td><td>{p.category}</td>
                  {page === 'storage' && <td>{p.shelf_life}</td>}<td className={String(p[key]).includes('[PLACEHOLDER]') ? 'placeholder-text' : ''}>{p[key] || '—'}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="page-header"><h1>Ordering Process & Timeline</h1></div>
      <div className="card prose">
        <h2>How ordering works</h2>
        <ol className="process">
          <li><strong>Place your order</strong> in Stock Purchase — choose pickup or delivery, the date and a time slot. Minimum order quantities apply.</li>
          <li><strong>COD accounts pay when ordering:</strong> transfer the total and attach the bank slip at checkout. 14-day accounts pay within 14 days of the invoice.</li>
          <li><strong>Straight to our kitchen</strong> — there is no waiting for approval. You can cancel online until the kitchen starts.</li>
          <li><strong>Invoice by email</strong> — our finance team sends the invoice and delivery order. Both are always under Payments.</li>
          <li><strong>Pickup or delivery</strong> on your chosen date. Delivery orders get a GoGet / Lalamove tracking link.</li>
          <li><strong>Mark as Received</strong> — check the items against the delivery order and confirm, or report a problem.</li>
        </ol>
        <p className="small muted">New orders are paused while an invoice is {info?.payment_term && info.payment_term !== 'COD' ? 'overdue' : 'unpaid (including slips still being verified)'}.</p>
      </div>

      <div className="card">
        <h2>Order timeline</h2>
        <p>Our office is open <strong>Monday to Friday</strong>. The daily cutoff is <strong>1:00 PM (Malaysia time)</strong>. An order placed after 1 PM, or on a Saturday or Sunday, counts as the next working day.</p>
        <p className="muted">Standard rule: Day 1 order (before 1 PM) → Day 2 production → Day 3 pickup / delivery.</p>
        <div className="table-wrap">
          <table className="timeline-table">
            <thead><tr><th>Order placed (before 1 PM)</th><th>Pickup / delivery dates allowed</th></tr></thead>
            <tbody>{TIMELINE.map(([a, b]) => <tr key={a}><td><strong>{a}</strong></td><td>{b}</td></tr>)}</tbody>
          </table>
        </div>
        <ul className="date-why">
          <li><strong>Sunday, Monday and Tuesday</strong> pickups/deliveries must be ordered by <strong>Friday 1:00 PM</strong>.</li>
          <li>Public holidays and closures are announced at the top of the portal and cannot be chosen at checkout.</li>
          <li>At checkout you will only see the dates still available for your order.</li>
        </ul>
      </div>

      <div className="two-col">
        <div className="card">
          <h2>Delivery & pickup</h2>
          {info ? <>
            <p>Delivery within <strong>{info.delivery_area}</strong> only. Flat delivery fee <strong>{money(info.delivery_fee)}</strong>, <strong>free</strong> when your order subtotal (before SST) is {money(info.free_delivery_threshold)} or more.</p>
            <p>SST {Math.round(info.sst_rate * 100)}% applies to products and the delivery fee.</p>
            <p><strong>Pickup outlet:</strong> {info.pickup_address}<br /><span className="muted small">Pickup slots: {info.pickup_slots.join(' · ')}</span></p>
          </> : <p>Loading…</p>}
        </div>
        <div className="card">
          <h2>Payment</h2>
          <p>Your account: <strong>{info?.term_label}</strong>. New customers start on COD and can request a 14-day credit term after 2 months under <Link to="/portal/account">Account</Link>.</p>
          {info?.outlet && <p className="small muted">Invoices are issued by <strong>{info.outlet.company_name}</strong> ({info.outlet.name}).</p>}
          <BankDetails bank={info?.bank} reference="your invoice number" />
        </div>
      </div>
    </div>
  )
}
