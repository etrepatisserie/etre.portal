import { useEffect, useState } from 'react'
import { api } from '../../api.js'
import { useToast } from '../../feedback.js'
import Icon from '../../components/Icon.jsx'
import { PageSkeleton } from '../../components/Skeleton.jsx'
import { outletLabel } from '../../outlet.js'

// Settings: each outlet's company, bank and pickup / delivery details (KL and Ipoh are separate companies),
// plus the ordering rules. Head office edits; outlet admins see their own outlet read-only.
const SECTIONS = [
  { title: 'Company', icon: 'Building2', hint: 'Printed on invoices, delivery orders and credit notes.', fields: [
    ['company_name', 'Company name', { required: true }], ['company_reg_no', 'Registration no.'], ['sst_reg_no', 'SST registration no.'],
    ['email', 'Company email', { type: 'email', help: 'Customer emails are sent from this address; also printed on invoices' }],
    ['company_address', 'Company address', { area: true, span: true }]] },
  { title: 'Bank account for payments', icon: 'Wallet', hint: 'Shown to customers at checkout, on the Payments page, on invoices and in emails.', fields: [
    ['bank_name', 'Bank', { required: true }], ['bank_account_name', 'Account name', { required: true }], ['bank_account_no', 'Account no.', { required: true, mono: true, placeholder: 'Digits only' }]] },
  { title: 'Pickup & delivery', icon: 'Truck', hint: 'What customers can choose at checkout.', fields: [
    ['pickup_address', 'Pickup address', { area: true, span: true }], ['pickup_slots', 'Pickup time slots', { area: true, list: true, help: 'One slot per line' }],
    ['delivery_slots', 'Delivery time slots', { area: true, list: true, help: 'One slot per line' }], ['delivery_area', 'Delivery area', { span: true, help: 'Customers confirm their address is in this area' }],
    ['delivery_fee', 'Delivery fee (RM)', { type: 'number', step: '0.01', help: 'Flat fee per delivery order, before SST' }], ['free_delivery_threshold', 'Free delivery from (RM)', { type: 'number', step: '0.01', help: 'Order subtotal before SST' }]] },
  { title: 'Invoices & delivery orders', icon: 'FileText', hint: 'The default for this company. Finance can still choose another method for a single invoice.', fields: [
    ['invoice_method', 'Invoices are', { options: [['generated', 'Generated PDF'], ['uploaded', 'Uploaded file (made elsewhere)'], ['bukku', 'Created in Bukku']], help: 'Bukku needs the connection set up first' }],
    ['do_method', 'Delivery orders are', { options: [['generated', 'Generated PDF (no prices)'], ['uploaded', 'Uploaded file']], help: 'Uploaded: the DO shows once Admin or Finance uploads it' }]] },
]
const RULES = [
  ['cutoff_time', 'Order cut-off time', { type: 'time', help: 'Orders after this count as the next working day' }],
  ['max_days_ahead', 'Furthest date a customer can pick (days)', { step: '1' }], ['credit_term_min_months', 'Months before a COD customer can ask for credit terms', { step: '1' }],
]
const isPlaceholder = (v) => String(v || '').includes('[PLACEHOLDER]')
const toForm = (o) => ({ ...o, pickup_slots: (o.pickup_slots || []).join('\n'), delivery_slots: (o.delivery_slots || []).join('\n') })

function OutletForm({ outlet, canEdit, onSaved }) {
  const toast = useToast()
  const [f, setF] = useState(() => toForm(outlet))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dirty = JSON.stringify(f) !== JSON.stringify(toForm(outlet))
  const save = async (e) => {
    e.preventDefault(); setError(''); setBusy(true)
    try {
      const body = Object.fromEntries(SECTIONS.flatMap((s) => s.fields.map(([k]) => [k, f[k]])))
      const o = await api.put(`/admin/settings/outlets/${outlet.id}`, body)
      onSaved(o); toast.success(`${outletLabel(outlet.code)} details saved.`)
    } catch (err) { setError(err.message); toast.error(err.message) } finally { setBusy(false) }
  }
  const missing = SECTIONS.flatMap((s) => s.fields).filter(([k]) => isPlaceholder(outlet[k])).map(([, l]) => l)
  return (
    <form onSubmit={save}>
      {missing.length > 0 && <div className="alert warn"><Icon name="AlertTriangle" size={18} /><span>Still placeholders: <strong>{missing.join(', ')}</strong>. Replace them before going live — customers see these.</span></div>}
      {SECTIONS.map((s) => (
        <section key={s.title} className="card settings-section">
          <div className="settings-head"><h2><Icon name={s.icon} size={18} /> {s.title}</h2><p className="muted small">{s.hint}</p></div>
          <div className="settings-grid">
            {s.fields.map(([k, label, o = {}]) => (
              <label key={k} className={`field ${o.span ? 'span-2' : ''}`}>
                <span className={o.required ? 'req' : ''}>{label}</span>
                {o.options
                  ? <select value={f[k] || o.options[0][0]} disabled={!canEdit} onChange={(e) => setF({ ...f, [k]: e.target.value })}>{o.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  : o.area
                  ? <textarea rows={o.list ? 3 : 2} value={f[k] || ''} disabled={!canEdit} onChange={(e) => setF({ ...f, [k]: e.target.value })} className={isPlaceholder(f[k]) ? 'invalid' : ''} />
                  : <input type={o.type || 'text'} step={o.step} min={o.type === 'number' ? 0 : undefined} value={f[k] ?? ''} disabled={!canEdit} placeholder={o.placeholder} className={`${o.mono ? 'mono' : ''} ${isPlaceholder(f[k]) ? 'invalid' : ''}`} onChange={(e) => setF({ ...f, [k]: e.target.value })} required={o.required} />}
                {o.help && <span className="field-help">{o.help}</span>}
              </label>
            ))}
          </div>
        </section>
      ))}
      {error && <div className="alert error"><Icon name="AlertCircle" size={18} /><span>{error}</span></div>}
      {canEdit && (
        <div className="sticky-actions">
          <span className="muted small">{dirty ? 'Unsaved changes' : 'All changes saved'} · invoices already generated keep the details they were issued with.</span>
          <button type="button" className="btn secondary" disabled={!dirty || busy} onClick={() => setF(toForm(outlet))}>Discard</button>
          <button className="btn primary" disabled={!dirty || busy}>{busy ? 'Saving…' : `Save ${outletLabel(outlet.code)} details`}</button>
        </div>
      )}
    </form>
  )
}

function RulesForm({ rules, canEdit, onSaved }) {
  const toast = useToast()
  const [f, setF] = useState(rules)
  const [busy, setBusy] = useState(false)
  const dirty = JSON.stringify(f) !== JSON.stringify(rules)
  const save = async (e) => {
    e.preventDefault(); setBusy(true)
    try { const r = await api.put('/admin/settings/rules', f); onSaved(r); setF(r); toast.success('Ordering rules saved. They apply to new orders.') }
    catch (err) { toast.error(err.message) } finally { setBusy(false) }
  }
  return (
    <form className="card settings-section" onSubmit={save}>
      <div className="settings-head"><h2><Icon name="SlidersHorizontal" size={18} /> Ordering rules</h2><p className="muted small">Both outlets. Changes apply to new orders only — placed orders keep their fees.</p></div>
      <div className="settings-grid">
        {RULES.map(([k, label, o]) => (
          <label key={k} className="field"><span>{label}</span>
            <input type={o.type || 'number'} min="0" step={o.step} value={f[k] ?? ''} disabled={!canEdit} onChange={(e) => setF({ ...f, [k]: o.type === 'time' ? e.target.value : e.target.value === '' ? '' : Number(e.target.value) })} />
            {o.help && <span className="field-help">{o.help}</span>}
          </label>
        ))}
        <div className="field"><span>SST</span><div className="fixed-value">{Math.round(rules.sst_rate * 100)}% <span className="muted small">· on products and delivery · set by law, not editable here</span></div></div>
      </div>
      <p className="muted small">Delivery fees are set per company above. Order by {f.cutoff_time} for the normal timeline. The customer Info page describes a 1 PM cut-off — update its wording if you change the time.</p>
      {canEdit && <div className="actions"><button type="button" className="btn secondary" disabled={!dirty || busy} onClick={() => setF(rules)}>Discard</button><button className="btn primary" disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save rules'}</button></div>}
    </form>
  )
}

export default function Settings() {
  const [d, setD] = useState(null)
  const [tab, setTab] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => { api.get('/admin/settings').then((x) => { setD(x); setTab(x.outlets[0]?.id) }).catch((e) => setError(e.message)) }, [])
  if (error) return <div className="alert error">{error}</div>
  if (!d) return <PageSkeleton cards={0} rows={8} />
  const outlet = d.outlets.find((o) => o.id === tab) || d.outlets[0]
  const savedOutlet = (o) => setD({ ...d, outlets: d.outlets.map((x) => (x.id === o.id ? o : x)) })
  return (
    <div>
      <div className="page-header">
        <div><h1>Settings</h1><div className="muted">Company, bank and checkout details for each outlet. KL and Ipoh are separate companies.</div></div>
        {!d.can_edit && <span className="badge tone-gray"><Icon name="Ban" size={14} /> Read only — head office makes changes</span>}
      </div>
      {d.outlets.length > 1 && (
        <div className="company-tabs" role="tablist" aria-label="Outlet">
          {d.outlets.map((o) => (
            <button key={o.id} type="button" role="tab" aria-selected={o.id === outlet.id} className={`company-tab co-${o.code.toLowerCase()} ${o.id === outlet.id ? 'on' : ''}`} onClick={() => setTab(o.id)}>
              <span className="company-dot" aria-hidden="true" /><span className="company-tab-label">{outletLabel(o.code)}</span><span className="company-tab-sub">{o.company_name}</span>
            </button>
          ))}
        </div>
      )}
      <OutletForm key={outlet.id} outlet={outlet} canEdit={d.can_edit} onSaved={savedOutlet} />
      <h2 className="section-title">Rules for both outlets</h2>
      <RulesForm rules={d.rules} canEdit={d.can_edit} onSaved={(r) => setD({ ...d, rules: r })} />
    </div>
  )
}
