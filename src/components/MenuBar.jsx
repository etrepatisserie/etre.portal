import { useState, useEffect, useRef } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import NotificationBell from './NotificationBell.jsx'

// Top menu bar used by both portals. `menu` comes from src/menus.js.
export default function MenuBar({ menu, brand, home, notificationsPath, extra }) {
  const [open, setOpen] = useState(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const { user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const ref = useRef(null)

  useEffect(() => { setOpen(null); setMobileOpen(false) }, [location.pathname])
  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(null) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const isActive = (m) => [m.base, ...(m.also || [])].some((b) => location.pathname.startsWith(b))

  const signOut = async () => { await logout(); navigate('/login') }

  return (
    <header className="menubar" ref={ref}>
      <NavLink to={home} className="brand"><span className="brand-mark">◆</span> {brand}</NavLink>
      <button className="hamburger" onClick={() => setMobileOpen(!mobileOpen)} aria-label="Toggle menu">☰</button>
      <nav className={`menu ${mobileOpen ? 'menu-open' : ''}`}>
        {menu.map((m) =>
          m.items ? (
            <div
              key={m.label}
              className={`menu-item has-sub ${open === m.label ? 'open' : ''} ${isActive(m) ? 'active' : ''}`}
              onMouseEnter={() => setOpen(m.label)}
              onMouseLeave={() => setOpen(null)}
            >
              <button className="menu-link" onClick={() => setOpen(open === m.label ? null : m.label)}>
                {m.label} <span className="caret">▾</span>
              </button>
              <div className="submenu">
                {m.items.map((it) => (
                  <NavLink key={it.to} to={it.to} end className="submenu-link">
                    {it.label}
                    {it.soon && <span className="soon">soon</span>}
                  </NavLink>
                ))}
              </div>
            </div>
          ) : (
            <NavLink key={m.label} to={m.to} end className="menu-item menu-link">{m.label}</NavLink>
          )
        )}
      </nav>
      <div className="menubar-right">
        {extra}
        <NotificationBell viewAllPath={notificationsPath} />
        <div className="user-chip">
          <div className="user-name">{user?.name}</div>
          <div className="user-sub">{user?.role === 'customer' ? user.customer_name : 'Administrator'}</div>
        </div>
        <button className="signout" onClick={signOut} title="Sign out">Sign out</button>
      </div>
    </header>
  )
}
