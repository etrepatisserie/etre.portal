import { useEffect, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { api, money } from '../../api.js'

// Customer "Stock Purchase": browse available stock, build a cart, place an order
export default function Shop() {
  const { cart, setCart } = useOutletContext()
  const [products, setProducts] = useState([])
  const [profile, setProfile] = useState(null)
  const [category, setCategory] = useState('All')
  const [q, setQ] = useState('')
  const [qtyDraft, setQtyDraft] = useState({})
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    api.get('/customer/products').then(setProducts)
    api.get('/customer/profile').then((p) => { setProfile(p); setAddress(p.address || '') })
  }, [])

  const categories = ['All', ...new Set(products.map((p) => p.category))]
  const shown = products.filter((p) =>
    (category === 'All' || p.category === category) &&
    (!q || `${p.name} ${p.sku}`.toLowerCase().includes(q.toLowerCase())))

  const inCart = (id) => cart[id]?.qty || 0
  const setQty = (p, qty) => {
    const next = { ...cart }
    const clamped = Math.max(0, Math.min(qty, p.available))
    if (clamped === 0) delete next[p.id]; else next[p.id] = { product: p, qty: clamped }
    setCart(next)
  }
  const add = (p) => {
    // first add defaults to the MOQ
    const qty = Math.max(1, parseInt(qtyDraft[p.id], 10) || (inCart(p.id) ? 1 : p.moq))
    setQty(p, Math.max(inCart(p.id) + qty, p.moq))
    setQtyDraft({ ...qtyDraft, [p.id]: '' })
  }

  const items = Object.values(cart)
  const total = items.reduce((a, i) => a + i.qty * i.product.price, 0)
  const belowMoq = items.filter((i) => i.qty < i.product.moq)
  const categoryNote = category !== 'All' && products.find((p) => p.category === category)?.category_note

  const placeOrder = async () => {
    setError(''); setBusy(true)
    try {
      const { id } = await api.post('/customer/orders', {
        lines: items.map((i) => ({ product_id: i.product.id, quantity: i.qty })),
        delivery_address: address, notes,
      })
      setCart({}); setNotes('')
      window.dispatchEvent(new Event('notifications:refresh'))
      navigate(`/portal/orders/${id}`, { state: { placed: true } })
    } catch (e) {
      setError(e.message)
      api.get('/customer/products').then(setProducts) // stock may have changed
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Stock Purchase</h1>
          <p className="muted">Welcome{profile ? `, ${profile.name}` : ''}. Quantities shown are available right now.</p>
        </div>
      </div>

      <div className="shop-layout">
        <section>
          <div className="toolbar">
            <input placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <div className="chips">
            {categories.map((c) => (
              <button key={c} className={`chip ${category === c ? 'on' : ''}`} onClick={() => setCategory(c)}>{c}</button>
            ))}
          </div>

          {categoryNote && <div className="alert info">🧈 {categoryNote}</div>}

          <div className="product-grid">
            {shown.map((p) => {
              const left = p.available - inCart(p.id)
              const cannotMeetMoq = !inCart(p.id) && p.available < p.moq
              return (
                <div key={p.id} className={`product-card ${p.available === 0 ? 'oos' : ''}`}>
                  <div className="product-cat">{p.category}</div>
                  <div className="product-name">{p.name}</div>
                  <div className="muted small">{p.sku}{p.size && p.size !== '1pc' ? ` · ${p.size}` : ''}</div>
                  <div className="product-price">{money(p.price)} <span className="muted small">/ {p.uom.toLowerCase()} · excl. SST</span></div>
                  <dl className="product-facts">
                    <dt>Min. order</dt><dd>{p.moq} {p.uom.toLowerCase()}</dd>
                    {p.rsp && <><dt>Suggested retail</dt><dd>{p.rsp}</dd></>}
                    {p.shelf_life && <><dt>Shelf life</dt><dd>{p.shelf_life}</dd></>}
                  </dl>
                  <div className={`avail ${p.available === 0 ? 'out' : p.available < p.moq * 3 ? 'low' : ''}`}>
                    {p.available === 0 ? '✕ Out of stock' : p.available < p.moq * 3 ? `! Only ${p.available} left` : `✓ ${p.available.toLocaleString()} available`}
                  </div>
                  {p.available > 0 && (
                    <div className="add-row">
                      <input type="number" min="1" max={left} placeholder={String(inCart(p.id) ? 1 : p.moq)} value={qtyDraft[p.id] ?? ''}
                        onChange={(e) => setQtyDraft({ ...qtyDraft, [p.id]: e.target.value })} disabled={left <= 0 || cannotMeetMoq} />
                      <button className="btn primary" onClick={() => add(p)} disabled={left <= 0 || cannotMeetMoq}>
                        {cannotMeetMoq ? 'Below MOQ' : left <= 0 ? 'Max in cart' : 'Add'}
                      </button>
                    </div>
                  )}
                  {inCart(p.id) > 0 && <div className="in-cart">{inCart(p.id)} in cart</div>}
                </div>
              )
            })}
            {shown.length === 0 && <div className="empty">No products match.</div>}
          </div>
        </section>

        <aside className="card cart">
          <h2>Your order</h2>
          {items.length === 0 && <p className="muted">Your cart is empty. Add products from the list.</p>}
          {items.map(({ product: p, qty }) => (
            <div key={p.id} className="cart-line">
              <div className="cart-name">{p.name}
                <div className={`small ${qty < p.moq ? 'neg' : 'muted'}`}>{money(p.price)} / {p.uom.toLowerCase()}{qty < p.moq ? ` · min. ${p.moq}` : ''}</div>
              </div>
              <input type="number" min="0" max={p.available} value={qty} onChange={(e) => setQty(p, parseInt(e.target.value, 10) || 0)} />
              <div className="num cart-amt">{money(qty * p.price)}</div>
              <button className="icon-btn" title="Remove" onClick={() => setQty(p, 0)}>✕</button>
            </div>
          ))}
          {items.length > 0 && <>
            <div className="totals"><div className="grand"><span>Total <span className="muted small">excl. SST</span></span><span>{money(total)}</span></div></div>
            {belowMoq.length > 0 && <div className="alert error small">Below minimum order: {belowMoq.map((i) => `${i.product.name} (min. ${i.product.moq})`).join(', ')}</div>}
            <label className="field">Delivery address
              <textarea rows="2" value={address} onChange={(e) => setAddress(e.target.value)} />
            </label>
            <label className="field">Notes for our team
              <textarea rows="2" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. deliver before 10am" />
            </label>
            {error && <div className="alert error">{error}</div>}
            <button className="btn primary block" disabled={busy || belowMoq.length > 0} onClick={placeOrder}>{busy ? 'Placing order…' : 'Place order'}</button>
            <p className="muted small">Stock is reserved for you as soon as the order is placed.</p>
          </>}
        </aside>
      </div>
    </div>
  )
}
