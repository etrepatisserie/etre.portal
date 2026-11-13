import { useState, useEffect } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useAuth } from '../auth.jsx'

const HOME = { admin: '/admin', finance: '/finance', kitchen: '/kitchen', customer: '/portal' }

// Demo accounts from the mock data — remove this list before going live
const DEMO = [
  { label: 'Admin — head office (KL + Ipoh)', email: 'admin@demo.test', password: 'admin123', role: 'admin' },
  { label: 'Admin — Ipoh only', email: 'admin.ipoh@demo.test', password: 'admin123', role: 'admin' },
  { label: 'Finance — KL & Ipoh (switch company in the page)', email: 'finance@demo.test', password: 'finance123', role: 'finance' },
  { label: 'Kitchen — KL', email: 'kitchen@demo.test', password: 'kitchen123', role: 'kitchen' },
  { label: 'Kitchen — Ipoh', email: 'kitchen.ipoh@demo.test', password: 'kitchen123', role: 'kitchen' },
]

export default function Login() {
  const { user, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [customers, setCustomers] = useState([])
  const navigate = useNavigate()
  const location = useLocation()
  const TERM = { COD: 'COD', NET14: '14-day', NET15: '15-day', NET30: '30-day' }

  // customer test logins (real customers with a test login, plus demo customers when demo data is loaded)
  useEffect(() => {
    fetch('/api/public/demo-accounts').then((r) => (r.ok ? r.json() : [])).then(setCustomers).catch(() => {})
  }, [])

  if (user) return <Navigate to={HOME[user.role]} replace />

  const submit = async (e, creds) => {
    e?.preventDefault()
    setError(''); setBusy(true)
    try {
      const u = await login(creds?.email ?? email, creds?.password ?? password)
      const home = HOME[u.role]
      const from = location.state?.from
      navigate(from && from.startsWith(home) ? from : home, { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-page">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand"><span className="brand-mark">◆</span> ERP Portal</div>
        <p className="muted">Sign in with your account. Customers and staff use the same page — you'll be taken to your own portal.</p>
        {error && <div className="alert error">{error}</div>}
        <label>Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="btn primary block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>

        <div className="demo-box">
          <div className="demo-title">Staff test accounts</div>
          {DEMO.map((d) => (
            <button type="button" key={d.email} className="demo-row" onClick={() => submit(null, d)} disabled={busy}>
              <span><strong>{d.label}</strong><span className="muted"> · {d.email}</span></span>
              <span className={`role-tag ${d.role}`}>{d.role}</span>
            </button>
          ))}
          {customers.length > 0 && <div className="demo-title">Customer test accounts</div>}
          {customers.map((c) => (
            <button type="button" key={c.email} className="demo-row" onClick={() => submit(null, { email: c.email, password: 'customer123' })} disabled={busy}>
              <span><strong>{c.name}</strong><span className="muted"> · {c.outlet_code === 'IPH' ? 'Ipoh' : 'KL'} · {TERM[c.payment_term] || c.payment_term} · {c.email}</span></span>
              <span className="role-tag customer">customer</span>
            </button>
          ))}
          <div className="muted small">Passwords: admin123 · finance123 · kitchen123 · customer123 (also staff@demo.test / staff123 — KL admin). Other customer logins are created by Admin under Customers.</div>
        </div>
      </form>
    </div>
  )
}
