import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api.js'
import OutletField from '../../components/OutletField.jsx'
import Icon from '../../components/Icon.jsx'

const genPassword = () => Math.random().toString(36).slice(2, 6) + Math.floor(1000 + Math.random() * 9000)

// Creates the customer record AND their portal login in one step
export default function CustomerForm() {
  const blank = { outlet_id: '', code: '', name: '', reg_no: '', contact: '', email: '', phone: '', address: '', billing_address: '', credit_limit: '', login_email: '', password: genPassword() }
  const [f, setF] = useState(blank)
  const [error, setError] = useState('')
  const [created, setCreated] = useState(null)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const save = async (e) => {
    e.preventDefault(); setError(''); setBusy(true)
    try {
      const c = await api.post('/admin/customers', f)
      setCreated({ ...c, login_email: f.login_email, password: f.login_email ? f.password : null })
      setF({ ...blank, password: genPassword() })
      window.dispatchEvent(new Event('notifications:refresh'))
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="breadcrumb"><Link to="/admin/customers">Customers</Link> / New</div>
          <h1>Add New Customer</h1>
        </div>
      </div>

      {created && (
        <div className="alert success">
          <strong><Icon name="CircleCheck" size={16} /> {created.name} ({created.code}) created.</strong> {created.password ? 'Share these portal login details with the customer:' : 'You can create their portal login later from the Customers list.'}
          {created.password && <div className="cred"><span>Email</span><code>{created.login_email}</code><span>Password</span><code>{created.password}</code></div>}
          <div className="small">The password is only shown once. <Link to="/admin/customers">Back to customers</Link></div>
        </div>
      )}
      {error && <div className="alert error">{error}</div>}

      <form onSubmit={save}>
        <div className="card">
          <h2>Company details</h2>
          <div className="grid-form">
            <OutletField value={f.outlet_id} onChange={(v) => setF({ ...f, outlet_id: v })} />
            <label>Customer / company name *<input value={f.name} onChange={set('name')} required /></label>
            <label>Debtor code<input value={f.code} onChange={set('code')} placeholder="e.g. 300-A001 (blank = automatic)" /></label>
            <label>Registration no.<input value={f.reg_no} onChange={set('reg_no')} /></label>
            <label>Contact person<input value={f.contact} onChange={set('contact')} /></label>
            <label>Contact email<input type="email" value={f.email} onChange={set('email')} placeholder="defaults to login email" /></label>
            <label>Phone<input value={f.phone} onChange={set('phone')} /></label>
            <label className="span-2">Delivery address<input value={f.address} onChange={set('address')} /></label>
            <label className="span-2">Billing address (if different)<input value={f.billing_address} onChange={set('billing_address')} /></label>
            <label>Credit limit (RM)<input type="number" min="0" value={f.credit_limit} onChange={set('credit_limit')} /></label>
          </div>
        </div>
        <div className="card">
          <h2>Portal login</h2>
          <p className="muted small">The customer signs in with these to buy stock and track orders. New B2B customers start on <strong>COD</strong>; they can request a 14-day term after 2 months.</p>
          <div className="grid-form">
            <label>Login email<input type="email" value={f.login_email} onChange={set('login_email')} placeholder="leave empty to add the login later" /></label>
            <label>Temporary password
              <div className="input-row">
                <input value={f.password} onChange={set('password')} minLength={6} />
                <button type="button" className="btn ghost" onClick={() => setF({ ...f, password: genPassword() })}>Generate</button>
              </div>
            </label>
          </div>
        </div>
        <div className="actions">
          <Link to="/admin/customers" className="btn ghost">Cancel</Link>
          <button className="btn primary" disabled={busy}>Create customer</button>
        </div>
      </form>
    </div>
  )
}
