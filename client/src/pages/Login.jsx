import { useState } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import Logo from '../components/Logo.jsx'
import Icon from '../components/Icon.jsx'

const HOME = { admin: '/admin', finance: '/finance', kitchen: '/kitchen', customer: '/portal' }

export default function Login() {
  const { user, login } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  if (user) return <Navigate to={HOME[user.role]} replace />

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      const u = await login(email, password)
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
      <aside className="login-aside" aria-hidden="true">
        <Logo sub="Wholesale & operations" />
        <div className="login-pitch">
          <h2>Orders, kitchen and accounts in one place.</h2>
          <p>For our café and hotel partners, and the Être Patisserie team in Kuala Lumpur and Ipoh.</p>
          <ul className="login-points">
            <li><Icon name="ShoppingCart" size={18} /> Order and track deliveries</li>
            <li><Icon name="ChefHat" size={18} /> Plan and record production</li>
            <li><Icon name="FileText" size={18} /> Invoices, payments and reports</li>
          </ul>
        </div>
        <div className="login-foot">KL and Ipoh are run as separate companies.</div>
      </aside>
      <main className="login-main">
      <form className="login-card" onSubmit={submit}>
        <Logo sub="Sign in" />
        <div><h1>Welcome back</h1>
        <p className="muted">Customers and staff use the same page — you'll be taken to your own portal.</p></div>
        {error && <div className="alert error">{error}</div>}
        <label>Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        <button className="btn primary block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small">Customer logins are created by Admin under Customers. Contact the office if you need access.</p>
      </form>
      </main>
    </div>
  )
}
