import { useState } from 'react'
import MasterDataPage from '../../components/MasterDataPage.jsx'
import { api, money } from '../../api.js'

export default function Products() {
  const [result, setResult] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [busy, setBusy] = useState(false)

  // Re-reads server/data/catalog.json — use after editing prices or adding items there
  const reimport = async () => {
    setBusy(true)
    try { setResult(await api.post('/admin/products/import-catalog')); setReloadKey((k) => k + 1) }
    catch (e) { setResult({ error: e.message }) }
    finally { setBusy(false) }
  }

  return (
    <MasterDataPage
      title="Products"
      endpoint="/admin/products"
      reloadKey={reloadKey}
      headerActions={<button className="btn secondary" onClick={reimport} disabled={busy}>{busy ? 'Importing…' : '↻ Re-import catalog'}</button>}
      intro={result && (
        result.error ? <div className="alert error">{result.error}</div> : (
          <div className="alert success">
            ✓ Catalog imported: {result.inserted.length} added, {result.updated.length} updated.
            {result.flagged.length > 0 && (
              <details className="small"><summary>{result.flagged.length} products have assumed values to review</summary>
                <ul>{result.flagged.map((f) => <li key={f.sku}><code>{f.sku}</code> {f.name} — {f.flags.join('; ')}</li>)}</ul>
              </details>
            )}
          </div>
        )
      )}
      fields={[
        { name: 'sku', label: 'SKU', required: true },
        { name: 'name', label: 'Name', required: true },
        { name: 'is_sellable', label: 'Type', default: '1', options: [['1', 'Product (sold to customers)'], ['0', 'Ingredient / packaging']] },
        { name: 'category', label: 'Category', default: 'General' },
        { name: 'size', label: 'Size', default: '1pc' },
        { name: 'uom', label: 'Unit', default: 'PC' },
        { name: 'sell_price', label: 'Wholesale price (RM, excl. SST)', type: 'number', step: '0.01', default: 0 },
        { name: 'moq', label: 'Minimum order qty', type: 'number', default: 1 },
        { name: 'recommended_rsp', label: 'Recommended RSP', default: '' },
        { name: 'shelf_life', label: 'Shelf life', default: '' },
        { name: 'unit_cost', label: 'Unit cost (RM)', type: 'number', step: '0.01', default: 0 },
        { name: 'reorder_level', label: 'Reorder level', type: 'number', default: 0 },
        { name: 'opening_stock', label: 'Opening stock', type: 'number', default: 0 },
      ]}
      columns={[
        { key: 'sku', label: 'SKU' },
        { key: 'name', label: 'Name', render: (r) => <><strong>{r.name}</strong>{r.size && <div className="muted small">{r.size}</div>}</> },
        { key: 'category', label: 'Category', render: (r) => <>{r.category}{!r.is_sellable && <div className="tag">not sold</div>}</> },
        { key: 'sell_price', label: 'Price', num: true, render: (r) => (r.is_sellable ? money(r.sell_price) : '—') },
        { key: 'moq', label: 'MOQ', num: true, render: (r) => (r.is_sellable ? `${r.moq} ${r.uom}` : '—') },
        { key: 'recommended_rsp', label: 'Rec. RSP' },
        { key: 'shelf_life', label: 'Shelf life' },
        { key: 'stock_on_hand', label: 'On hand', num: true, render: (r) => r.stock_on_hand },
      ]}
    />
  )
}
