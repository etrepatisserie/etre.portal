import { money } from '../api.js'

// Subtotal → Delivery fee → SST → Total, used everywhere totals appear
export default function Totals({ t, method, hint }) {
  return (
    <div className="totals">
      <div><span>Subtotal</span><span>{money(t.subtotal)}</span></div>
      <div>
        <span>Delivery fee</span>
        <span>{method === 'pickup' ? <span className="muted">Pickup</span> : t.delivery_fee > 0 ? money(t.delivery_fee) : <strong className="free">FREE</strong>}</span>
      </div>
      <div><span>SST {Math.round((t.sst_rate ?? 0.06) * 100)}% <span className="muted small">(on subtotal + delivery)</span></span><span>{money(t.sst_amount)}</span></div>
      <div className="grand"><span>Total <span className="muted small">incl. SST</span></span><span>{money(t.total)}</span></div>
      {hint && <div className="totals-hint">{hint}</div>}
    </div>
  )
}

// Client-side preview of the server's pricing rules (the server recalculates on submit)
export function previewTotals(subtotal, method, info) {
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100
  const sub = r2(subtotal)
  const fee = method === 'delivery' && sub < info.free_delivery_threshold ? info.delivery_fee : 0
  const sst = r2((sub + fee) * info.sst_rate)
  return { subtotal: sub, delivery_fee: fee, sst_rate: info.sst_rate, sst_amount: sst, total: r2(sub + fee + sst), to_free: method === 'delivery' && fee > 0 ? r2(info.free_delivery_threshold - sub) : 0 }
}
