import { useEffect, useState, useCallback } from 'react'
import { api, upload } from '../../api.js'
import ProductImage from '../../components/ProductImage.jsx'

// Upload product photos (JPG / PNG / WEBP, max 10 MB) and switch products on/off for ordering
export default function ProductImages() {
  const [rows, setRows] = useState([])
  const [busy, setBusy] = useState(null)
  const [msg, setMsg] = useState(null)
  const [filter, setFilter] = useState('all')
  const load = useCallback(() => api.get('/admin/product-images').then(setRows), [])
  useEffect(() => { load() }, [load])

  const send = async (p, file) => {
    if (!file) return
    setBusy(p.id); setMsg(null)
    try { const fd = new FormData(); fd.append('image', file); await upload(`/admin/products/${p.id}/image`, fd); setMsg({ ok: true, text: `Photo saved for ${p.name}.` }); load() }
    catch (e) { setMsg({ ok: false, text: `${p.name}: ${e.message}` }) } finally { setBusy(null) }
  }
  const remove = async (p) => { if (confirm(`Remove the photo of ${p.name}?`)) { await api.del(`/admin/products/${p.id}/image`); load() } }
  const toggle = async (p) => { await api.post(`/admin/products/${p.id}/availability`, { is_available: !p.is_available }); load() }

  const shown = rows.filter((p) => filter === 'all' || (filter === 'missing' ? !p.image_url : filter === 'off' ? !p.is_available : true))
  return (
    <div>
      <div className="page-header"><h1>Product Images</h1></div>
      <p className="muted">Customers see these photos on product cards and in the cart. Until a photo is added, a placeholder is shown. You can also pre-load photos by putting files in <code>server/data/product-images/</code> and setting <code>"image"</code> in <code>catalog.json</code>.</p>
      <div className="chips">
        {[['all', 'All'], ['missing', `No photo (${rows.filter((r) => !r.image_url).length})`], ['off', `Unavailable (${rows.filter((r) => !r.is_available).length})`]].map(([k, l]) => (
          <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      {msg && <div className={`alert ${msg.ok ? 'success' : 'error'}`}>{msg.text}</div>}
      <div className="product-grid">
        {shown.map((p) => (
          <div key={p.id} className={`product-card ${!p.is_available ? 'oos' : ''}`}>
            <ProductImage src={p.image_url} name={p.name} />
            <div className="product-body">
              <div className="product-cat">{p.category}</div>
              <div className="product-name">{p.name}</div>
              <div className="muted small">{p.sku}</div>
              <label className="btn secondary small upload-btn">
                {busy === p.id ? 'Uploading…' : p.image_url ? 'Replace photo' : 'Upload photo'}
                <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { send(p, e.target.files[0]); e.target.value = '' }} />
              </label>
              {p.image_url && <button className="linkish small" onClick={() => remove(p)}>Remove photo</button>}
              <label className="check small">
                <input type="checkbox" checked={!!p.is_available} onChange={() => toggle(p)} /> <span>Available to order</span>
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
