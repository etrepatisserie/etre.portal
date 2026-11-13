import { useEffect, useState, useCallback } from 'react'
import { Link, useParams, useLocation, useOutletContext, useNavigate } from 'react-router-dom'
import { api, upload, money, fmtDateTime, fmtDay } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import Totals from '../../components/Totals.jsx'
import FileLink from '../../components/FileLink.jsx'
import { Stepper, EventList } from '../../components/Timeline.jsx'
import NextStep from '../../components/NextStep.jsx'
import Icon from '../../components/Icon.jsx'
import { useConfirm, useToast } from '../../feedback.js'

export default function OrderDetail() {
  const confirm = useConfirm()
  const toast = useToast()
  const { id } = useParams()
  const { state } = useLocation()
  const { cart, setCart } = useOutletContext()
  const navigate = useNavigate()
  const [so, setSo] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => api.get(`/customer/orders/${id}`).then(setSo).catch((e) => setError(e.message)), [id])
  useEffect(() => { load() }, [load])

  const cancel = async () => {
    if (!await confirm({ title: `Cancel order ${so.so_number}?`, body: 'The kitchen will not make it. This cannot be undone.', confirmLabel: 'Cancel order', cancelLabel: 'Keep order', danger: true })) return
    try { await api.post(`/customer/orders/${id}/cancel`); toast.success(`Order ${so.so_number} cancelled.`); load(); window.dispatchEvent(new Event('notifications:refresh')) }
    catch (e) { setError(e.message); toast.error(e.message) }
  }

  // "Buy again" — same lines into the cart (respecting MOQ and availability)
  const reorder = async () => {
    const products = await api.get('/customer/products')
    const next = { ...cart }
    for (const l of so.lines.filter((x) => x.original_quantity > 0)) {
      const p = products.find((x) => x.id === l.product_id)
      if (p && p.available) next[p.id] = { product: p, qty: Math.max(p.moq, (next[p.id]?.qty || 0) + l.original_quantity) }
    }
    setCart(next)
    navigate('/portal')
  }

  if (error && !so) return <div className="alert error">{error}</div>
  if (!so) return <p>Loading…</p>
  const adjusted = so.lines.some((l) => l.quantity !== l.original_quantity)
  const inv = so.invoice
  const unpaid = inv && !inv.void && ['Unpaid', 'Rejected'].includes(inv.payment_status)
  const day = fmtDay(so.fulfil_date)
  const payBtn = <Link to="/portal/payments" className="btn primary">Pay & upload slip</Link>
  const payText = inv && <>Transfer <strong>{money(inv.total)}</strong> for <strong className="mono">{inv.inv_number}</strong> by {fmtDay(inv.due_date)}, then upload the slip.{inv.payment_status === 'Rejected' && <> Your last slip was <strong>rejected</strong> — please upload a new one.</>}</>

  // ---- what happens next ----
  let next
  const notStarted = ['Pending', 'Confirmed', 'Invoiced'].includes(so.status)
  const payLine = inv
    ? (inv.payment_status === 'Paid' ? 'Invoice paid — thank you.' : inv.payment_status === 'Slip Uploaded' ? 'Your payment slip is being verified.' : '')
    : so.replacement_for ? `Replacement for ${so.replacement_for_number} — no charge.` : so.order_slip ? 'Payment slip received — your invoice will follow by email.' : 'Your invoice will follow by email.'
  if (['Ready for Pickup', 'Out for Delivery'].includes(so.status)) next = so.method === 'pickup'
    ? <NextStep status={so.status} title={`Collect your order on ${day}`}>{so.pickup_address} · {so.time_slot}. Check the items against the delivery order, then confirm below.</NextStep>
    : <NextStep status={so.status} title="Your order is on the way" actions={so.delivery_link && <a className="btn primary" href={so.delivery_link} target="_blank" rel="noopener noreferrer"><Icon name="MapPin" size={16} /> Track on {so.delivery_provider}</a>}>When it arrives, check the items against the delivery order and confirm below.</NextStep>
  else if (unpaid) next = <NextStep status={inv.payment_status} title={`Pay invoice ${inv.inv_number}`} actions={<>{payBtn}{notStarted && <button className="btn ghost" onClick={cancel}>Cancel order</button>}</>}>{payText}</NextStep>
  else if (notStarted) next = <NextStep status="Confirmed" kind="wait" who="our kitchen" title={`Order received — we'll make it for ${day}`} actions={<button className="btn ghost" onClick={cancel}>Cancel order</button>}>{payLine} You can cancel until our kitchen starts.</NextStep>
  else if (so.status === 'Processing') next = <NextStep status="Processing" kind="wait" who="our kitchen" title={`Being prepared for ${day}`}>{payLine} We'll let you know when it's {so.method === 'pickup' ? 'ready to collect' : 'on the way'}.</NextStep>
  else if (so.status === 'Received') next = <NextStep status="Received" kind="done" title="Completed — thank you!">{so.discrepancies.some((d) => d.status === 'Open') ? "We're looking into the problem you reported." : so.replacement_for ? 'Replacement received — thank you.' : 'Received and paid.'}</NextStep>
  else next = <NextStep status="Cancelled" kind="done" tone="gray" title="This order was cancelled" actions={<button className="btn secondary" onClick={reorder}>Order these items again</button>} />

  return (
    <div>
      {state?.placed && <div className="alert success"><Icon name="CircleCheck" size={16} /> Thank you! Order {so.so_number} has been placed. We'll confirm it shortly and send your invoice.</div>}
      <div className="page-header">
        <div>
          <div className="breadcrumb"><Link to="/portal/orders">Purchase History</Link> / {so.so_number}</div>
          <h1>{so.so_number} <StatusBadge status={so.status} /> {so.invoice && <StatusBadge status={so.invoice.payment_status} />}</h1>
          <div className="muted">Placed {fmtDateTime(so.order_date)}</div>
        </div>
        <div className="actions inline">
          <button className="btn ghost" onClick={reorder}>Buy again</button>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {next}
      {['Ready for Pickup', 'Out for Delivery'].includes(so.status) && <ReceivePanel so={so} onDone={load} />}
      {['Ready for Pickup', 'Out for Delivery'].includes(so.status) && unpaid && <div className="alert info">Reminder: {payText} <Link to="/portal/payments">Pay now →</Link></div>}

      <div className="card">
        <Stepper status={so.status} method={so.method} audience="customer" />
        <div className="info-grid">
          <div>
            <div className="label">{so.method === 'pickup' ? 'Pickup' : 'Delivery'} date</div>
            <div><strong>{fmtDay(so.fulfil_date)}</strong> · {so.time_slot}</div>
          </div>
          <div>
            <div className="label">{so.method === 'pickup' ? 'Pickup outlet' : 'Deliver to'}</div>
            <div>{so.method === 'pickup' ? so.pickup_address : so.delivery_address}</div>
          </div>
          <div>
            <div className="label">Tracking</div>
            {so.delivery_link
              ? <a className="btn secondary small" href={so.delivery_link} target="_blank" rel="noopener noreferrer"><Icon name="MapPin" size={16} /> Track on {so.delivery_provider}</a>
              : <div className="muted">{so.method === 'pickup' ? 'Not needed for pickup' : 'Link appears once delivery is booked'}</div>}
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <h2>Items</h2>
          {adjusted && <div className="alert info small">Some quantities were adjusted by our team before confirmation — see the change history below.</div>}
          <div className="table-wrap">
            <table>
              <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Price</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {so.lines.map((l) => (
                  <tr key={l.id} className={l.quantity === 0 ? 'removed' : ''}>
                    <td>{l.description}<div className="muted small">{l.sku}</div></td>
                    <td className="num">
                      {l.quantity !== l.original_quantity && <s className="muted">{l.original_quantity}</s>} {l.quantity === 0 ? 'Removed' : `${l.quantity} ${l.uom}`}
                    </td>
                    <td className="num">{money(l.unit_price)}</td><td className="num">{money(l.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Totals t={so} method={so.method} />
          {so.notes && <><div className="label">Your notes</div><p>{so.notes}</p></>}
        </div>

        <div>
          <div className="card">
            <h2>Documents & payment</h2>
            {so.invoice ? <>
              <div className="doc-row">
                <span><Icon name="FileText" size={16} /> Invoice <strong className="mono">{so.invoice.inv_number}</strong></span>
                <span><FileLink url={`/documents/invoices/${so.invoice.id}/invoice`}>View</FileLink> · <FileLink download url={`/documents/invoices/${so.invoice.id}/invoice`} filename={`${so.invoice.inv_number}.pdf`}>Download</FileLink></span>
              </div>
              <div className="doc-row">
                <span><Icon name="Package" size={16} /> Delivery Order <strong className="mono">{so.invoice.do_number}</strong></span>
                <span><FileLink url={`/documents/invoices/${so.invoice.id}/do`}>View</FileLink> · <FileLink download url={`/documents/invoices/${so.invoice.id}/do`} filename={`${so.invoice.do_number}.pdf`}>Download</FileLink></span>
              </div>
              <div className="doc-row">
                <span>Payment <StatusBadge status={so.invoice.payment_status} /></span>
                <span className="muted small">Due {fmtDay(so.invoice.due_date)}</span>
              </div>
              {so.credit_notes.map((c) => (
                <div key={c.id} className="doc-row">
                  <span><Icon name="FileMinus" size={16} /> Credit note <strong className="mono">{c.cn_number}</strong> · − {money(c.total)}</span>
                  <span><FileLink url={`/documents/credit-notes/${c.id}`}>View</FileLink> · <FileLink download url={`/documents/credit-notes/${c.id}`} filename={`${c.cn_number}.pdf`}>Download</FileLink></span>
                </div>
              ))}
              {so.invoice.payment_status !== 'Paid' && <Link to="/portal/payments" className="btn primary small">Pay / upload slip</Link>}
            </> : so.replacement_for ? <p className="muted">Replacement for <Link to={`/portal/orders/${so.replacement_for}`} className="mono">{so.replacement_for_number}</Link> — no charge, no invoice.</p>
              : <p className="muted">Your invoice and delivery order will appear here as soon as our finance team issues them.</p>}
            {!so.invoice && so.order_slip && <div className="doc-row"><span><Icon name="Upload" size={16} /> Payment slip sent with this order · <FileLink url={`/files/${so.order_slip.file_id}`}>View</FileLink></span><StatusBadge status={so.order_slip.status === 'Pending' ? 'Slip Uploaded' : so.order_slip.status} /></div>}
          </div>

          {so.discrepancies.length > 0 && (
            <div className="card">
              <h2>Reported issues</h2>
              {so.discrepancies.map((d) => (
                <div key={d.id} className="doc-row">
                  <span>{d.product_name}{d.qty != null ? ` · qty ${d.qty}` : ''} — {d.note}</span>
                  <span><StatusBadge status={d.status} />{d.resolution && <div className="small muted">{d.action === 'replacement' && d.replacement_so_id ? <Link to={`/portal/orders/${d.replacement_so_id}`}>Replacement {d.replacement_so_number}</Link> : d.action === 'credit_note' ? 'Settled with a credit note' : d.resolution}</div>}</span>
                </div>
              ))}
            </div>
          )}

          {so.adjustments.length > 0 && (
            <div className="card">
              <h2>Change history</h2>
              <table>
                <thead><tr><th>When</th><th>Item</th><th className="num">Qty</th><th>Reason</th></tr></thead>
                <tbody>{so.adjustments.map((a) => (
                  <tr key={a.id}><td className="small muted">{fmtDateTime(a.created_at)}</td><td>{a.product_name}</td>
                    <td className="num">{a.old_qty} → {a.new_qty === 0 ? 'removed' : a.new_qty}</td><td className="small">{a.reason}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}

          <div className="card"><h2>History</h2><EventList events={so.events} /></div>
        </div>
      </div>
    </div>
  )
}

// "Mark as Received": confirm items match the DO, or report a discrepancy (item, qty, note, optional photo)
function ReceivePanel({ so, onDone }) {
  const [matches, setMatches] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [rows, setRows] = useState([{ line_id: '', qty: '', note: '' }])
  const [photo, setPhoto] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const lines = so.lines.filter((l) => l.quantity > 0)

  const submit = async () => {
    setError(''); setBusy(true)
    try {
      const fd = new FormData()
      fd.append('data', JSON.stringify({ matches_do: !reporting && matches, discrepancies: reporting ? rows : [] }))
      if (reporting && photo) fd.append('photo', photo)
      await upload(`/customer/orders/${so.id}/receive`, fd)
      window.dispatchEvent(new Event('notifications:refresh'))
      onDone()
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  const setRow = (i, patch) => setRows(rows.map((r, n) => (n === i ? { ...r, ...patch } : r)))

  return (
    <div className="card highlight">
      <h2>{so.method === 'pickup' ? 'Collected your order?' : 'Has your order arrived?'}</h2>
      <p className="muted small">Please check every item against the Delivery Order ({so.invoice?.do_number}) before confirming.</p>
      {!reporting ? (
        <label className="check">
          <input type="checkbox" checked={matches} onChange={(e) => setMatches(e.target.checked)} />
          <span>I confirm the items received <strong>match the Delivery Order</strong>.</span>
        </label>
      ) : (
        <div className="form-stack">
          {rows.map((r, i) => (
            <div key={i} className="disc-row">
              <select value={r.line_id} onChange={(e) => setRow(i, { line_id: e.target.value })} aria-label="Item">
                <option value="">— Item with a problem —</option>
                {lines.map((l) => <option key={l.id} value={l.id}>{l.description} (ordered {l.quantity})</option>)}
              </select>
              <input type="number" min="0" placeholder="Qty affected" value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} aria-label="Quantity affected" />
              <input placeholder="What's wrong? e.g. 2 missing, damaged" value={r.note} onChange={(e) => setRow(i, { note: e.target.value })} aria-label="Note" />
              {rows.length > 1 && <button className="icon-btn" onClick={() => setRows(rows.filter((_, n) => n !== i))} aria-label="Remove this item" title="Remove"><Icon name="X" size={16} /></button>}
            </div>
          ))}
          <button className="btn ghost small" onClick={() => setRows([...rows, { line_id: '', qty: '', note: '' }])}><Icon name="Plus" size={16} /> Another item</button>
          <label className="field">Photo (optional, JPG/PNG/PDF up to 10 MB)
            <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setPhoto(e.target.files[0] || null)} />
          </label>
        </div>
      )}
      {error && <div className="alert error">{error}</div>}
      <div className="actions">
        <button className="btn ghost" onClick={() => setReporting(!reporting)}>{reporting ? 'Everything is fine' : 'Report a discrepancy'}</button>
        <button className="btn primary" disabled={busy || (!reporting && !matches)} onClick={submit}>
          {reporting ? 'Submit report & mark as received' : 'Mark as Received'}
        </button>
      </div>
    </div>
  )
}
