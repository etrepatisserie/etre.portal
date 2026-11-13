import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { api, money, fmtDate } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import OutletTag, { useShowOutlet } from '../../components/OutletTag.jsx'
import Icon from '../../components/Icon.jsx'

const genPassword = () => Math.random().toString(36).slice(2, 6) + Math.floor(1000 + Math.random() * 9000)

// Customers of the outlet(s) you can see. Real customers come from the accounting system's debtor list;
// give them a portal login when they're ready to order online.
export default function Customers() {
  const [rows, setRows] = useState([])
  const [q, setQ] = useState('')
  const [kind, setKind] = useState('real')
  const [loginFor, setLoginFor] = useState(null) // { id, login_email, password }
  const [created, setCreated] = useState(null)
  const [error, setError] = useState('')
  const showOutlet = useShowOutlet()
  const load = useCallback(() => api.get('/admin/customers').then(setRows), [])
  useEffect(() => { load() }, [load])

  const shown = rows.filter((c) => (kind === 'all' || (kind === 'demo' ? c.is_demo : !c.is_demo))
    && (!q || `${c.code} ${c.name} ${c.contact} ${c.login_email} ${c.reg_no}`.toLowerCase().includes(q.toLowerCase())))

  const saveLogin = async (c) => {
    setError('')
    try {
      await api.post(`/admin/customers/${c.id}/login`, { login_email: loginFor.login_email, password: loginFor.password })
      setCreated({ name: c.name, email: loginFor.login_email, password: loginFor.password })
      setLoginFor(null); load()
    } catch (e) { setError(e.message) }
  }

  return (
    <div>
      <div className="page-header">
        <h1>Customers</h1>
        <Link to="/admin/customers/new" className="btn primary"><Icon name="UserPlus" size={18} /> Add New Customer</Link>
      </div>
      {created && (
        <div className="alert success">
          <strong><Icon name="CircleCheck" size={16} /> Portal login created for {created.name}.</strong> Share these details with the customer:
          <div className="cred"><span>Email</span><code>{created.email}</code><span>Password</span><code>{created.password}</code></div>
          <div className="small">The password is only shown once.</div>
        </div>
      )}
      {error && <div className="alert error">{error}</div>}
      <div className="card">
        <div className="toolbar">
          <label className="search-box"><Icon name="Search" size={16} /><input aria-label="Search name, code, reg. no" placeholder="Search name, code, reg. no…" value={q} onChange={(e) => setQ(e.target.value)} /></label>
          <div className="chips inline">
            {rows.some((c) => c.is_demo) && [['real', `Real customers (${rows.filter((c) => !c.is_demo).length})`], ['demo', `Demo (${rows.filter((c) => c.is_demo).length})`], ['all', 'All']].map(([k, l]) => (
              <button key={k} className={`chip ${kind === k ? 'on' : ''}`} onClick={() => setKind(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Customer</th><th>Contact</th><th>Term</th><th className="num">Credit limit</th><th>Portal login</th><th className="num">Orders</th><th className="num">Outstanding</th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan="8" className="empty"><Icon name="Inbox" size={24} className="empty-icon" />No customers.</td></tr>}
              {shown.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.code}</td>
                  <td>
                    <strong>{c.name}</strong>{showOutlet && <OutletTag code={c.outlet_code} />}
                    {c.reg_no && <div className="muted small">Reg. {c.reg_no}</div>}
                    <div className="muted small">{c.address || c.billing_address || <span className="flag-note">No address on file</span>}</div>
                  </td>
                  <td className="small">{c.contact || '—'}<div className="muted">{[c.phone, c.phone2].filter(Boolean).join(' · ') || <span className="flag-note">No phone</span>}</div><div className="muted">{c.email}</div></td>
                  <td><StatusBadge status={c.payment_term} /></td>
                  <td className="num">{c.credit_limit ? money(c.credit_limit) : '—'}</td>
                  <td className="small">
                    {c.login_email ? c.login_email
                      : loginFor?.id === c.id ? (
                        <div className="form-stack tight">
                          <input type="email" placeholder="Login email" value={loginFor.login_email} onChange={(e) => setLoginFor({ ...loginFor, login_email: e.target.value })} />
                          <input placeholder="Password" value={loginFor.password} onChange={(e) => setLoginFor({ ...loginFor, password: e.target.value })} />
                          <div className="row-gap"><button className="btn primary small" onClick={() => saveLogin(c)}>Create</button><button className="btn ghost small" onClick={() => setLoginFor(null)}>Cancel</button></div>
                        </div>
                      ) : <button className="btn secondary small" onClick={() => setLoginFor({ id: c.id, login_email: c.email || '', password: genPassword() })}>Create login</button>}
                  </td>
                  <td className="num">{c.order_count}<div className="muted small">{c.last_order ? fmtDate(c.last_order) : ''}</div></td>
                  <td className="num">{c.outstanding > 0 ? money(c.outstanding) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
