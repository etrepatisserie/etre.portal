import { useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useAuth } from '../auth.jsx'

// Demo accounts from the mock data — remove this list before going live
const DEMO = [
  { label: 'Admin', email: 'admin@demo.test', password: 'admin123', role: 'admin' },
  { label: 'Warehouse staff', email: 'staff@demo.test', password: 'staff123', role: 'admin' },
  { label: 'Harbor Hotel Group', email: 'harbor@demo.test', password: 'customer123', role: 'customer' },
  { label: 'Maple Street Bakery', email: 'maple@demo.test', password: 'customer123', role: 'customer' },
  { label: 'Sweet Corner Café', email: 'cafe@demo.test', password: 'customer123', role: 'customer' },
]

export default function Login() {
  const { user, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  if (user) return <Navigate to={user.role === 'admin' ? '/admin' : '/portal'} replace />

  const submit = async (e, creds) => {
    e?.preventDefault()
    setError(''); setBusy(true)
    try {
      const u = await login(creds?.email ?? email, creds?.password ?? password)
      const home = u.role === 'admin' ? '/admin' : '/portal'
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
          <div className="demo-title">Demo accounts (mock data)</div>
          {DEMO.map((d) => (
            <button type="button" key={d.email} className="demo-row" onClick={() => submit(null, d)} disabled={busy}>
              <span><strong>{d.label}</strong><span className="muted"> · {d.email}</span></span>
              <span className={`role-tag ${d.role}`}>{d.role}</span>
            </button>
          ))}
          <div className="muted small">Passwords: admin123 · staff123 · customer123</div>
        </div>
      </form>
    </div>
  )
}
