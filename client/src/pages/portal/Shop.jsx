import { useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { api, upload, money, fmtDay } from '../../api.js'
import BankDetails from '../../components/BankDetails.jsx'
import DateCalendar from '../../components/DateCalendar.jsx'
import ProductImage from '../../components/ProductImage.jsx'
import Totals, { previewTotals } from '../../components/Totals.jsx'
import NextStep from '../../components/NextStep.jsx'
import Icon from '../../components/Icon.jsx'

// Customer "Stock Purchase": browse the catalog (no stock levels shown), build a cart, check out
export default function Shop() {
  const { cart, setCart } = useOutletContext()
  const [products, setProducts] = useState([])
  const [info, setInfo] = useState(null)
  const [profile, setProfile] = useState(null)
  const [category, setCategory] = useState('All')
  const [q, setQ] = useState('')
  const [qtyDraft, setQtyDraft] = useState({})
  const [slip, setSlip] = useState(null)
  const [slipKey, setSlipKey] = useState(0)
  const [method, setMethod] = useState('delivery')
  const [address, setAddress] = useState('')      // a different address for this order only
  const [otherAddr, setOtherAddr] = useState(false)
  const [areaOk, setAreaOk] = useState(false)
  const [date, setDate] = useState('')
  const [slot, setSlot] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [openOrders, setOpenOrders] = useState([])   // earlier open orders this one can be an add-on to
  const [isAddon, setIsAddon] = useState(false)
  const [addonOf, setAddonOf] = useState('')
  const navigate = useNavigate()

  const loadInfo = () => api.get('/customer/checkout-info').then((i) => { setInfo(i); setDate((d) => (i.window.dates.includes(d) ? d : i.window.dates[0])) })
  useEffect(() => {
    api.get('/customer/products').then(setProducts)
    api.get('/customer/profile').then((p) => { setProfile(p); if (!p.registered_address) setOtherAddr(true) })
    api.get('/customer/orders').then((rows) => setOpenOrders(rows.filter((o) => !['Received', 'Cancelled'].includes(o.status))))
    loadInfo()
  }, [])
  useEffect(() => { if (info) setSlot((method === 'pickup' ? info.pickup_slots : info.delivery_slots)[0]) }, [method, info])

  const categories = ['All', ...new Set(products.map((p) => p.category))]
  const shown = products.filter((p) =>
    (category === 'All' || p.category === category) &&
    (!q || `${p.name} ${p.sku}`.toLowerCase().includes(q.toLowerCase())))
  const categoryNote = category !== 'All' && products.find((p) => p.category === category)?.category_note

  const inCart = (id) => cart[id]?.qty || 0
  const setQty = (p, qty) => {
    const next = { ...cart }
    if (qty <= 0) delete next[p.id]; else next[p.id] = { product: p, qty }
    setCart(next)
  }
  const add = (p) => {
    const qty = Math.max(1, parseInt(qtyDraft[p.id], 10) || (inCart(p.id) ? p.moq : p.moq))
    setQty(p, Math.max(inCart(p.id) + qty, p.moq))
    setQtyDraft({ ...qtyDraft, [p.id]: '' })
  }

  const items = Object.values(cart)
  const subtotal = items.reduce((a, i) => a + i.qty * i.product.price, 0)
  const belowMoq = items.filter((i) => i.qty < i.product.moq)
  const t = info ? previewTotals(subtotal, method, info) : null
  // closures can block pickup and delivery separately: dates and reasons for the chosen method
  const methodDates = info ? (info.window.by_method?.[method] || info.window.dates) : []
  const chosenDate = methodDates.includes(date) ? date : methodDates[0] || ''
  const closedFor = info ? (info.window.blocked_info || []).filter((b) => b[method]) : []

  const placeOrder = async () => {
    setError(''); setBusy(true)
    try {
      const body = {
        lines: items.map((i) => ({ product_id: i.product.id, quantity: i.qty })),
        method, fulfil_date: chosenDate, time_slot: slot, notes, addon_of: isAddon && addonOf ? Number(addonOf) : undefined,
        area_confirmed: method === 'delivery' && otherAddr ? areaOk : false,
        delivery_address: method === 'delivery' && otherAddr ? address : undefined,
      }
      let id
      if (cod) {
        const fd = new FormData()
        fd.append('data', JSON.stringify(body))
        fd.append('slip', slip)
        ;({ id } = await upload('/customer/orders', fd))
      } else ({ id } = await api.post('/customer/orders', body))
      setCart({}); setNotes(''); setSlip(null); setSlipKey((k) => k + 1)
      window.dispatchEvent(new Event('notifications:refresh'))
      navigate(`/portal/orders/${id}`, { state: { placed: true } })
    } catch (e) {
      setError(e.message)
      loadInfo() // dates or payment status may have changed
    } finally {
      setBusy(false)
    }
  }

  const cod = info?.payment_term === 'COD'
  // delivery: registered business address by default; a different address needs the area tick
  const addrOk = method === 'pickup' || (otherAddr ? areaOk && address.trim() : !!profile?.registered_address)
  const missing = !info || !items.length ? ''
    : info.blocked ? 'Ordering is paused until your outstanding invoices are paid (see top of page).'
    : belowMoq.length ? 'Raise the items marked in red to their minimum quantity.'
    : method === 'delivery' && otherAddr && !address.trim() ? 'Enter the delivery address in step 2.'
    : method === 'delivery' && otherAddr && !areaOk ? 'Tick the delivery-area box in step 2.'
    : isAddon && !addonOf ? 'Choose the order this adds to, or untick "add-on".'
    : cod && !slip ? 'Attach your payment slip in step 4.' : ''
  const canSubmit = info && !info.blocked && items.length && !belowMoq.length && chosenDate && slot && addrOk && (!cod || slip) && (!isAddon || addonOf)
  const owed = info?.blocking_invoices || []

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Stock Purchase</h1>
          <p className="muted">Welcome{profile ? `, ${profile.name}` : ''}. Wholesale prices are shown before SST.</p>
        </div>
      </div>

      {info?.blocked && (
        <NextStep status="Overdue" tone="red" title="New orders are paused until your payment is verified"
          actions={<Link to="/portal/payments" className="btn primary">Pay & upload slip</Link>}>
          <p>Outstanding: <strong>{money(owed.reduce((a, i) => a + i.total, 0))}</strong></p>
          <ul className="owed-list">{owed.map((i) => <li key={i.id}><span className="mono">{i.inv_number}</span> · {money(i.total)} · due {fmtDay(i.due_date)}{i.due_date < info.window.now_myt ? <strong className="neg"> · overdue</strong> : ''}{i.payment_status === 'Slip Uploaded' ? ' · slip uploaded, being verified' : ''}</li>)}</ul>
          <p className="small"><strong>How to pay:</strong> transfer the amount to our bank account, then go to <Link to="/portal/payments">Payments</Link>, tick the invoice(s) and upload the bank slip. You can still log in, see your invoices and upload slips at any time.</p>
          <p className="small">Ordering opens again once our finance team has verified the payment, or if they grant a temporary exception.</p>
        </NextStep>
      )}
      {info?.override && (
        <div className="alert info"><Icon name="Info" size={18} /><span>Our finance team has allowed you to order {info.override.single_order ? 'one order' : `until ${fmtDay(info.override.expires_on)}`} while your payment is outstanding. Please settle {owed.map((i) => i.inv_number).join(', ')} as soon as possible.</span></div>
      )}

      <div className="shop-layout">
        <section>
          <div className="toolbar"><label className="search-box"><Icon name="Search" size={16} /><input aria-label="Search products" placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} /></label></div>
          <div className="chips">
            {categories.map((c) => <button key={c} className={`chip ${category === c ? 'on' : ''}`} onClick={() => setCategory(c)}>{c}</button>)}
          </div>
          {categoryNote && <div className="alert info"><Icon name="Info" size={16} /> {categoryNote}</div>}

          <div className="product-grid">
            {shown.map((p) => (
              <div key={p.id} className={`product-card ${!p.available ? 'oos' : ''}`}>
                <ProductImage src={p.image_url} name={p.name} />
                <div className="product-body">
                  <div className="product-cat">{p.category}</div>
                  <div className="product-name">{p.name}</div>
                  <div className="muted small">{p.sku}{p.size && p.size !== '1pc' ? ` · ${p.size}` : ''}</div>
                  <div className="product-price">{money(p.price)} <span className="muted small">/ {p.uom.toLowerCase()} · excl. SST</span></div>
                  <div className="product-chips"><span>Min. order {p.moq} {p.uom.toLowerCase()}</span></div>
                  {p.available ? (
                    <div className="add-row">
                      <input type="number" min="1" placeholder={String(p.moq)} value={qtyDraft[p.id] ?? ''} aria-label={`Quantity of ${p.name}`}
                        onChange={(e) => setQtyDraft({ ...qtyDraft, [p.id]: e.target.value })} />
                      <button className="btn primary" onClick={() => add(p)}>Add</button>
                    </div>
                  ) : <div className="avail out">Currently unavailable</div>}
                  {inCart(p.id) > 0 && <div className="in-cart">{inCart(p.id)} in cart</div>}
                </div>
              </div>
            ))}
            {shown.length === 0 && <div className="empty"><Icon name="Search" size={24} className="empty-icon" />No products match.</div>}
          </div>
        </section>

        <aside className="card cart">
          <h2>Your order</h2>
          <div className={`co-step ${items.length ? 'done' : ''}`}><span className="co-no">{items.length ? <Icon name="Check" size={14} /> : 1}</span> Choose items</div>
          {items.length === 0 && <p className="muted small">Press <strong>Add</strong> on a product. The minimum order quantity is filled in for you.</p>}
          {items.map(({ product: p, qty }) => (
            <div key={p.id} className="cart-line">
              <ProductImage src={p.image_url} name={p.name} className="thumb" />
              <div className="cart-name">{p.name}
                <div className={`small ${qty < p.moq ? 'neg' : 'muted'}`}>{money(p.price)} / {p.uom.toLowerCase()}{qty < p.moq ? ` · min. ${p.moq}` : ''}</div>
              </div>
              <input type="number" min="0" value={qty} aria-label={`Quantity of ${p.name}`} onChange={(e) => setQty(p, parseInt(e.target.value, 10) || 0)} />
              <div className="num cart-amt">{money(qty * p.price)}</div>
              <button className="icon-btn" title="Remove" aria-label={`Remove ${p.name}`} onClick={() => setQty(p, 0)}><Icon name="X" size={16} /></button>
            </div>
          ))}

          {items.length > 0 && info && <>
            <div className={`co-step ${addrOk ? 'done' : ''}`}><span className="co-no">{addrOk ? <Icon name="Check" size={14} /> : 2}</span> Pickup or delivery</div>
            <fieldset className="method">
              <label className={method === 'delivery' ? 'on' : ''}><input type="radio" name="method" checked={method === 'delivery'} onChange={() => setMethod('delivery')} /> <Icon name="Truck" size={18} /> Delivery</label>
              <label className={method === 'pickup' ? 'on' : ''}><input type="radio" name="method" checked={method === 'pickup'} onChange={() => setMethod('pickup')} /> <Icon name="Store" size={18} /> Pickup</label>
            </fieldset>
            {method === 'delivery' ? <>
              {profile?.registered_address && <>
                <div className={`pickup-box ${otherAddr ? 'muted' : ''}`}><div className="label">Deliver to · registered business address</div>{profile.registered_address}</div>
                <label className="check">
                  <input type="checkbox" checked={otherAddr} onChange={(e) => setOtherAddr(e.target.checked)} />
                  <span>Deliver to a different address for this order</span>
                </label>
              </>}
              {otherAddr && <>
                <label className="field">{profile?.registered_address ? 'Different address' : 'Deliver to'}
                  <textarea rows="2" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Full address for this delivery" />
                </label>
                <label className="check">
                  <input type="checkbox" checked={areaOk} onChange={(e) => setAreaOk(e.target.checked)} />
                  <span>This address is in <strong>{info.delivery_area}</strong></span>
                </label>
              </>}
            </> : <div className="pickup-box"><div className="label">Collect from</div>{info.pickup_address}</div>}

            <div className="co-step done"><span className="co-no"><Icon name="Check" size={14} /></span> <Icon name="Calendar" size={16} /> Date & time</div>
            <DateCalendar dates={methodDates} value={chosenDate} onChange={setDate} closed={closedFor.map((b) => b.date)}
              reasons={Object.fromEntries(closedFor.map((b) => [b.date, b[method]]))} />
            {closedFor.length > 0 && <p className="small closed-note"><Icon name="CalendarDays" size={14} /> Closed for {method === 'pickup' ? 'pickup' : 'delivery'}: {closedFor.map((b) => `${fmtDay(b.date)} (${b[method]})`).join('; ')}.</p>}
            <details className="co-hint">
              <summary>Earliest {fmtDay(info.window.earliest)} · Why these dates?</summary>
              <ul className="date-why">{info.window.explanation.map((x) => <li key={x}>{x}</li>)}</ul>
            </details>
            <label className="field"><span className="sr-only">Time slot</span>
              <select value={slot} onChange={(e) => setSlot(e.target.value)} aria-label="Time slot">
                {(method === 'pickup' ? info.pickup_slots : info.delivery_slots).map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            {openOrders.length > 0 && <>
              <label className="check">
                <input type="checkbox" checked={isAddon} onChange={(e) => setIsAddon(e.target.checked)} />
                <span>This is an <strong>add-on</strong> to an earlier order (extra items — it gets its own order number, invoice and DO)</span>
              </label>
              {isAddon && <label className="field">Adds to
                <select value={addonOf} onChange={(e) => setAddonOf(e.target.value)} aria-label="Order this adds to">
                  <option value="">— Choose your earlier order —</option>
                  {openOrders.map((o) => <option key={o.id} value={o.id}>{o.so_number} · {o.method === 'pickup' ? 'pickup' : 'delivery'} {fmtDay(o.fulfil_date)}</option>)}
                </select>
              </label>}
            </>}

            <div className="co-step"><span className="co-no">4</span> {cod ? 'Pay & attach your slip' : 'Check your total'}</div>
            <Totals t={t} method={method} hint={method === 'delivery' && (t.to_free > 0
              ? <>Add <strong>{money(t.to_free)}</strong> more for <strong>free delivery</strong>.</>
              : <><Icon name="CircleCheck" size={16} /> Free delivery</>)} />
            {cod && <>
              <p className="small">Your account is <strong>COD</strong>: transfer <strong>{money(t.total)}</strong> now, then attach the bank slip.</p>
              <BankDetails bank={info.bank} />
              <label className={`field slip-pick ${slip ? 'ok' : ''}`}>Payment slip (photo or PDF)
                <input key={slipKey} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setSlip(e.target.files[0] || null)} />
              </label>
            </>}
            <details className="co-hint">
              <summary>Add a note for our team</summary>
              <textarea rows="2" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. call on arrival" />
            </details>
            {belowMoq.length > 0 && <div className="alert error small">Below minimum order: {belowMoq.map((i) => `${i.product.name} (min. ${i.product.moq})`).join(', ')}</div>}
            {error && <div className="alert error">{error}</div>}
            <div className="co-step"><span className="co-no">5</span> Place order</div>
            <button className="btn primary block" disabled={busy || !canSubmit} onClick={placeOrder}>{busy ? 'Placing order…' : `Place order · ${money(t.total)}`}</button>
            {!canSubmit && missing && <p className="small neg">{missing}</p>}
            <p className="muted small">Your order goes straight to our kitchen. The invoice follows by email{cod ? '.' : ` — pay within ${info.term_label} by bank transfer.`} <Link to="/portal/info/prices">Suggested selling prices</Link> · <Link to="/portal/info/storage">Storage guide</Link></p>
          </>}
        </aside>
      </div>
    </div>
  )
}
