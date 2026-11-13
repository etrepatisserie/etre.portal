import { useEffect, useState, useCallback } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, money, fmtDateTime, fmtDay } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import NextStep from '../../components/NextStep.jsx'
import Totals, { previewTotals } from '../../components/Totals.jsx'
import FileLink from '../../components/FileLink.jsx'
import { Stepper, EventList } from '../../components/Timeline.jsx'
import Icon from '../../components/Icon.jsx'
import { useConfirm, useToast } from '../../feedback.js'

const PROVIDERS = ['Lalamove', 'GoGet', 'Other']

export default function SalesOrderView() {
  const confirm = useConfirm()
  const toast = useToast()
  const { id } = useParams()
  const [so, setSo] = useState(null)
  const [rules, setRules] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState(null) // { [line_id]: { quantity, reason } }
  const [link, setLink] = useState({ provider: PROVIDERS[0], url: '' })

  const load = useCallback(() => api.get(`/admin/sales-orders/${id}`).then((o) => { setSo(o); setLink({ provider: o.delivery_provider || PROVIDERS[0], url: o.delivery_link || '' }) }).catch((e) => setError(e.message)), [id])
  useEffect(() => { load(); api.get('/admin/checkout-info').then(setRules) }, [load])

  const run = async (fn, okText) => {
    setError(''); setBusy(true)
    try { await fn(); await load(); window.dispatchEvent(new Event('notifications:refresh')); if (okText) toast.success(okText) }
    catch (e) { setError(e.message); toast.error(e.message) } finally { setBusy(false) }
  }
  const dispatch = () => run(() => api.post(`/admin/sales-orders/${id}/dispatch`), `${so.so_number} is ${so.method === 'pickup' ? 'ready for pickup' : 'out for delivery'} — customer notified.`)
  const cancel = async () => {
    const reason = await confirm({ title: `Cancel ${so.so_number}?`, body: 'The customer is notified and the kitchen will not make it. This cannot be undone.',
      input: { label: 'Reason for the customer', placeholder: 'e.g. Out of an ingredient this week' }, confirmLabel: 'Cancel order', cancelLabel: 'Keep order', danger: true })
    if (reason === null) return
    run(() => api.post(`/admin/sales-orders/${id}/cancel`, { reason }), `${so.so_number} cancelled — customer notified.`)
  }
  const saveLink = () => run(() => api.post(`/admin/sales-orders/${id}/delivery-link`, link), 'Tracking link saved — customer notified.')
  const startEdit = () => setEdit(Object.fromEntries(so.lines.map((l) => [l.id, { quantity: l.quantity, reason: '' }])))
  const saveEdit = () => run(async () => {
    const changes = so.lines.filter((l) => Number(edit[l.id].quantity) !== l.quantity)
      .map((l) => ({ line_id: l.id, quantity: Number(edit[l.id].quantity), reason: edit[l.id].reason }))
    await api.post(`/admin/sales-orders/${id}/adjust`, { changes })
    setEdit(null)
  })

  if (error && !so) return <div className="alert error">{error}</div>
  if (!so) return <p>Loading…</p>
  const notStarted = ['Pending', 'Confirmed', 'Invoiced'].includes(so.status)
  const canCancel = notStarted || so.status === 'Processing'
  const canAdjust = notStarted && !(so.invoice && (so.invoice.payment_status === 'Paid' || so.invoice.source === 'uploaded'))
  const financeLine = so.replacement_for ? `No-charge replacement for ${so.replacement_for_number} — not invoiced.` : so.invoice ? `Invoice ${so.invoice.inv_number} issued (${so.invoice.payment_status.toLowerCase()}).` : `Finance has been alerted to issue the invoice${so.order_slip ? ' — the COD payment slip is attached' : ''}.`
  const editSubtotal = edit ? so.lines.reduce((a, l) => a + (Number(edit[l.id].quantity) || 0) * l.unit_price, 0) : 0
  const preview = edit && rules ? previewTotals(editSubtotal, so.method, rules) : null
  const openIssues = so.discrepancies.filter((d) => d.status === 'Open').length
  const when = `${so.method === 'pickup' ? 'pickup' : 'delivery'} on ${fmtDay(so.fulfil_date)}`

  const linkForm = (
    <div className="input-row">
      <select value={link.provider} onChange={(e) => setLink({ ...link, provider: e.target.value })} style={{ maxWidth: 130 }} aria-label="Provider">
        {PROVIDERS.map((p) => <option key={p}>{p}</option>)}
      </select>
      <input value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} placeholder="Paste tracking link https://…" aria-label="Tracking link" />
      <button className="btn secondary" disabled={busy || !link.url} onClick={saveLink}>{so.delivery_link ? 'Update link' : 'Send link to customer'}</button>
    </div>
  )

  // ---- what happens next ----
  let next
  if (edit) next = null
  else if (notStarted) next = (
    <NextStep status="Confirmed" kind="wait" who="the kitchen" title={`New order — the kitchen makes it on ${fmtDay(so.production_date)}`}
      actions={canAdjust && <button className="btn secondary" disabled={busy} onClick={startEdit}>Something short? Adjust quantities</button>}>
      Nothing to do unless an item is short. Customer wants {when}. {financeLine}
    </NextStep>
  )
  else if (so.status === 'Processing') next = so.method === 'pickup'
    ? <NextStep status="Processing" title="When it's packed, mark it ready for pickup"
        actions={<button className="btn primary" disabled={busy} onClick={dispatch}><Icon name="PackageCheck" size={18} /> Mark ready for pickup</button>}>
        Customer collects on {fmtDay(so.fulfil_date)}, {so.time_slot}. They are notified straight away.
      </NextStep>
    : <NextStep status="Processing" title="Book the driver, send the tracking link, then mark out for delivery"
        actions={<button className="btn primary" disabled={busy} onClick={dispatch}><Icon name="Truck" size={18} /> Mark out for delivery</button>}>
        <p><strong>1.</strong> Book GoGet / Lalamove and paste the tracking link (the customer gets it by email and in the portal):</p>
        {linkForm}
        <p><strong>2.</strong> When the driver collects, mark the order out for delivery.</p>
      </NextStep>
  else if (so.status === 'Out for Delivery') next = (
    <NextStep status="Out for Delivery" kind={so.delivery_link ? 'wait' : 'you'} who="the customer" title={so.delivery_link ? 'On the way — the customer will confirm receipt' : 'Send the tracking link to the customer'}>
      {!so.delivery_link ? linkForm : <>Tracking: <a href={so.delivery_link} target="_blank" rel="noopener noreferrer">{so.delivery_provider}</a></>}
    </NextStep>
  )
  else if (so.status === 'Ready for Pickup') next = <NextStep status="Ready for Pickup" kind="wait" who="the customer" title={`Waiting for the customer to collect on ${fmtDay(so.fulfil_date)}`}>{so.time_slot}</NextStep>
  else if (so.status === 'Received') next = openIssues
    ? <NextStep status="Open" tone="red" title={`Customer reported ${openIssues} problem${openIssues > 1 ? 's' : ''} — resolve it`} actions={<Link to="/admin/discrepancies" className="btn primary">Resolve discrepancy</Link>}>See "Discrepancies" below.</NextStep>
    : <NextStep status="Received" kind="done" title="Completed — received by the customer">Items matched the delivery order.</NextStep>
  else next = <NextStep status="Cancelled" kind="done" tone="gray" title="Cancelled">{so.cancel_reason}</NextStep>

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="breadcrumb"><Link to="/admin/sales">Sales Orders</Link> / {so.so_number}</div>
          <h1>{so.so_number} <StatusBadge status={so.status} />{so.invoice && <StatusBadge status={so.invoice.payment_status} />}</h1>
          <div className="muted">{so.customer_name} · placed {fmtDateTime(so.order_date)}</div>
        </div>
        <div className="actions inline">
          {canCancel && !edit && <button className="btn ghost" disabled={busy} onClick={cancel}>Cancel order</button>}
          <button className="btn ghost" onClick={() => window.print()}><Icon name="Printer" size={18} /> Print</button>
        </div>
      </div>
      {error && <div className="alert error">{error}</div>}
      {next}

      <div className="card">
        <Stepper status={so.status} method={so.method} />
        <div className="info-grid">
          <div>
            <div className="label">Customer</div>
            <div><strong>{so.customer_name}</strong> ({so.customer_code}) · <StatusBadge status={so.payment_term} /></div>
            <div className="muted small">{so.customer_contact} · {so.customer_email} · {so.customer_phone}</div>
          </div>
          <div>
            <div className="label">{so.method === 'pickup' ? 'Pickup' : 'Delivery'}</div>
            <div><strong>{fmtDay(so.fulfil_date)}</strong> · {so.time_slot}</div>
            <div className="muted small">Production {fmtDay(so.production_date)}</div>
            {so.method === 'delivery' && <div className="small">{so.delivery_address} {so.area_confirmed ? <span className="tag"><Icon name="Check" size={14} /> KL / Klang Valley</span> : null}</div>}
          </div>
          <div>
            <div className="label">Invoice</div>
            {so.invoice ? <>
              <div className="mono">{so.invoice.inv_number} · {so.invoice.do_number}</div>
              <div className="small">Due {fmtDay(so.invoice.due_date)} · <FileLink url={`/documents/invoices/${so.invoice.id}/invoice`}>Invoice</FileLink> · <FileLink url={`/documents/invoices/${so.invoice.id}/do`}>DO</FileLink></div>
              {so.invoice.void ? <span className="tag">Void</span> : null}
              {so.credit_notes.map((c) => <div key={c.id} className="small"><Icon name="FileMinus" size={16} /> Credit note {c.status === 'Issued' ? <FileLink url={`/documents/credit-notes/${c.id}`}>{c.cn_number}</FileLink> : <StatusBadge status={c.status} label={c.status === 'Requested' ? 'With Finance' : 'Declined'} />} · {money(c.total)}</div>)}
            </> : so.replacement_for ? <div className="muted">Replacement for <Link to={`/admin/sales/${so.replacement_for}`} className="mono">{so.replacement_for_number}</Link> — no charge, not invoiced</div>
              : <div className="muted">Not invoiced yet — Finance alerted</div>}
            {so.order_slip && <div className="small">COD slip: <FileLink url={`/files/${so.order_slip.file_id}`}>view</FileLink> <StatusBadge status={so.order_slip.status === 'Pending' ? 'Slip Uploaded' : so.order_slip.status} /></div>}
            {so.delivery_link && <div className="small">Tracking: <a href={so.delivery_link} target="_blank" rel="noopener noreferrer">{so.delivery_provider}</a></div>}
          </div>
        </div>
        {so.notes && <><div className="label">Customer notes</div><p>{so.notes}</p></>}
      </div>

      <div className="two-col">
        <div className={`card ${edit ? 'highlight' : ''}`}>
          <h2>{edit ? 'Adjust quantities' : 'Items'}</h2>
          {edit && <p className="muted small">Lower or remove what you can't supply and give a reason. The customer is emailed the old and new quantities and the new total.</p>}
          <div className="table-wrap">
            <table className={edit ? 'lines' : ''}>
              <thead><tr><th>Product</th><th className="num">Ordered</th><th className="num">{edit ? 'New qty' : 'Qty'}</th>{edit && <th>Reason</th>}<th className="num">Price</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {so.lines.map((l) => {
                  const q = edit ? Number(edit[l.id].quantity) || 0 : l.quantity
                  const changed = edit && q !== l.quantity
                  return (
                    <tr key={l.id} className={q === 0 ? 'removed' : ''}>
                      <td>{l.description}<div className="muted small">{l.sku} · MOQ {l.moq}</div></td>
                      <td className="num">{l.original_quantity}</td>
                      <td className="num">{edit
                        ? <input type="number" min="0" max={l.quantity} className="num" style={{ width: 80 }} value={edit[l.id].quantity} onChange={(e) => setEdit({ ...edit, [l.id]: { ...edit[l.id], quantity: e.target.value } })} />
                        : <>{l.quantity === 0 ? 'Removed' : `${l.quantity} ${l.uom}`}</>}</td>
                      {edit && <td>{changed && <input placeholder="Reason (required)" value={edit[l.id].reason} onChange={(e) => setEdit({ ...edit, [l.id]: { ...edit[l.id], reason: e.target.value } })} />}</td>}
                      <td className="num">{money(l.unit_price)}</td>
                      <td className="num">{money(q * l.unit_price)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {edit ? <>
            <div className="compare">
              <div><div className="label">Now</div><Totals t={so} method={so.method} /></div>
              <div><div className="label">After change</div>{preview && <Totals t={preview} method={so.method} />}</div>
            </div>
            <div className="actions">
              <button className="btn ghost" onClick={() => setEdit(null)}>Back</button>
              <button className="btn primary" disabled={busy} onClick={saveEdit}>Save & email customer</button>
            </div>
          </> : <Totals t={so} method={so.method} />}
        </div>

        <div>
          {so.discrepancies.length > 0 && (
            <div className="card">
              <div className="card-head"><h2>Discrepancies</h2><Link to="/admin/discrepancies">All →</Link></div>
              {so.discrepancies.map((d) => (
                <div key={d.id} className="doc-row">
                  <span><strong>{d.product_name}</strong>{d.qty != null ? ` · qty ${d.qty}` : ''} — {d.note}{d.file_id && <> · <FileLink url={`/files/${d.file_id}`}>photo</FileLink></>}</span>
                  <StatusBadge status={d.status} />
                </div>
              ))}
            </div>
          )}
          {so.adjustments.length > 0 && (
            <div className="card">
              <h2>Change history</h2>
              <table>
                <thead><tr><th>When</th><th>Item</th><th className="num">Qty</th><th>Reason</th><th>By</th></tr></thead>
                <tbody>{so.adjustments.map((a) => (
                  <tr key={a.id}><td className="small muted">{fmtDateTime(a.created_at)}</td><td>{a.product_name}</td>
                    <td className="num">{a.old_qty} → {a.new_qty}</td><td className="small">{a.reason}</td><td className="small muted">{a.user_name}</td></tr>
                ))}</tbody>
              </table>
              <div className="small muted">Total {money(so.adjustments[0].totals_before?.total)} → {money(so.adjustments[so.adjustments.length - 1].totals_after?.total)}</div>
            </div>
          )}
          <div className="card"><h2>History</h2><EventList events={so.events} /></div>
        </div>
      </div>
    </div>
  )
}
