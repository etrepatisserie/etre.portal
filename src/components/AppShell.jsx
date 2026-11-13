import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import { navIcon } from '../icons.js'
import { trailFor } from '../menus.js'
import Icon from './Icon.jsx'
import Logo from './Logo.jsx'
import NotificationBell from './NotificationBell.jsx'
import OutletSwitch from './OutletSwitch.jsx'
import CommandPalette from './CommandPalette.jsx'

const ROLE_LABEL = { admin: 'Administrator', finance: 'Finance', kitchen: 'Central Kitchen', customer: 'Customer' }
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

// Left sidebar + compact top bar for every portal. `menu` comes from src/menus.js (only the signed-in role's items).
export default function AppShell({ menu, portal, home, notificationsPath, topExtra, hideOutletSwitch, children }) {
  const location = useLocation()
  const [drawer, setDrawer] = useState(false)
  const [palette, setPalette] = useState(false)
  const path = location.pathname + location.search
  const activeGroup = (m) => [m.base, ...(m.also || [])].some((b) => b && location.pathname.startsWith(b))
  const [openGroups, setOpenGroups] = useState(() => Object.fromEntries(menu.filter((m) => m.items).map((m) => [m.label, activeGroup(m)])))
  const [lastPath, setLastPath] = useState(location.pathname)
  if (lastPath !== location.pathname) { // new page: close the phone drawer, open the group we're in
    setLastPath(location.pathname); setDrawer(false)
    const g = menu.find((m) => m.items && activeGroup(m))
    if (g && !openGroups[g.label]) setOpenGroups({ ...openGroups, [g.label]: true })
  }

  useEffect(() => {
    const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette(true) } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (!drawer) return
    const onKey = (e) => { if (e.key === 'Escape') setDrawer(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawer])

  const itemActive = (it) => (it.to.includes('?') ? path === it.to : location.pathname === it.to && !(location.search && menu.some((m) => m.items?.some((x) => x.to === path))))
  const trail = trailFor(menu, location.pathname, location.search)

  return (
    <div className={`shell ${drawer ? 'drawer-open' : ''}`}>
      <a href="#main" className="skip-link">Skip to content</a>
      <aside className="sidebar" aria-label="Main menu">
        <div className="sidebar-head">
          <Link to={home} className="sidebar-brand" aria-label={`Être Patisserie ${portal} — home`}><Logo sub={portal} /></Link>
          <button type="button" className="icon-btn sidebar-close" onClick={() => setDrawer(false)} aria-label="Close menu" title="Close menu"><Icon name="X" size={20} /></button>
        </div>
        <nav className="side-nav">
          {menu.map((m) => m.items ? (
            <div key={m.label} className={`side-group ${openGroups[m.label] ? 'open' : ''} ${activeGroup(m) ? 'active' : ''}`}>
              <button type="button" className="side-link side-group-btn" aria-expanded={!!openGroups[m.label]}
                onClick={() => setOpenGroups({ ...openGroups, [m.label]: !openGroups[m.label] })}>
                <Icon name={navIcon(m)} size={18} /><span className="side-text">{m.label}</span><Icon name="ChevronDown" size={16} className="side-caret" />
              </button>
              {openGroups[m.label] && (
                <div className="side-sub">
                  {m.items.map((it) => (
                    <NavLink key={it.to} to={it.to} end className={() => `side-link sub ${itemActive(it) ? 'active' : ''}`} aria-current={itemActive(it) ? 'page' : undefined}>
                      <span className="side-text">{it.label}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <NavLink key={m.label} to={m.to} end className={({ isActive }) => `side-link ${isActive ? 'active' : ''}`}>
              <Icon name={navIcon(m)} size={18} /><span className="side-text">{m.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <button type="button" className="side-link search-launch" onClick={() => setPalette(true)}>
            <Icon name="Search" size={18} /><span className="side-text">Go to…</span><kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
          </button>
        </div>
      </aside>
      <div className="drawer-backdrop" onClick={() => setDrawer(false)} aria-hidden="true" />

      <div className="main-col">
        <header className="topbar">
          <button type="button" className="icon-btn menu-btn" onClick={() => setDrawer(true)} aria-label="Open menu" title="Menu" aria-expanded={drawer}><Icon name="Menu" size={22} /></button>
          <Link to={home} className="topbar-logo" aria-label="Home"><Logo compact /></Link>
          <nav className="crumbs" aria-label="Breadcrumb">
            {trail.group && <span className="crumb">{trail.group}</span>}
            {trail.page && (trail.detail
              ? <><Link className="crumb link" to={trail.to}>{trail.page}</Link><span className="crumb current" aria-current="page">{trail.detail}</span></>
              : <span className="crumb current" aria-current="page">{trail.page}</span>)}
          </nav>
          <div className="topbar-right">
            <button type="button" className="search-btn" onClick={() => setPalette(true)} aria-label="Search pages" title={`Search pages (${isMac ? '⌘' : 'Ctrl'}-K)`}>
              <Icon name="Search" size={16} /><span className="search-btn-text">Search…</span><kbd>{isMac ? '⌘' : 'Ctrl'} K</kbd>
            </button>
            {!hideOutletSwitch && <OutletSwitch />}
            {topExtra}
            <NotificationBell viewAllPath={notificationsPath} />
            <UserMenu notificationsPath={notificationsPath} />
          </div>
        </header>
        <main id="main" className="content" tabIndex={-1}>{children}</main>
      </div>
      <CommandPalette menu={menu} extra={[{ to: notificationsPath, label: 'Notifications', group: '', icon: 'Bell' }]} open={palette} onClose={() => setPalette(false)} />
    </div>
  )
}

function UserMenu({ notificationsPath }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  if (!user) return null
  const initials = (user.name || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  const sub = user.role === 'customer' ? user.customer_name : `${ROLE_LABEL[user.role]}${user.head_office ? ' · head office' : user.outlet_name ? ` · ${user.outlet_name}` : ''}`
  const signOut = async () => { await logout(); navigate('/login') }
  return (
    <div className="user-menu" ref={ref}>
      <button type="button" className="user-btn" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title={user.name}>
        <span className="avatar" aria-hidden="true">{initials}</span>
        <span className="user-btn-text"><span className="user-name">{user.name}</span><span className="user-sub">{sub}</span></span>
        <Icon name="ChevronDown" size={14} className="user-caret" />
      </button>
      {open && (
        <div className="user-pop" role="menu">
          <div className="user-pop-head"><strong>{user.name}</strong><span className="muted small">{user.email}</span><span className="muted small">{sub}</span></div>
          <Link role="menuitem" className="user-pop-item" to={notificationsPath} onClick={() => setOpen(false)}><Icon name="Bell" size={16} /> Notifications</Link>
          <button role="menuitem" type="button" className="user-pop-item" onClick={signOut}><Icon name="LogOut" size={16} /> Sign out</button>
        </div>
      )}
    </div>
  )
}
