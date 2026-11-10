import { useEffect, useRef, useState, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, timeAgo } from '../api.js'

const POLL_MS = 15000
const TYPE_ICON = { new_order: '🛒', order_status: '🚚', low_stock: '⚠️', customer: '👤', info: 'ℹ️' }

// Bell with unread count, dropdown of latest notifications, and a toast when new ones arrive
export default function NotificationBell({ viewAllPath }) {
  const [data, setData] = useState({ unread: 0, items: [] })
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState(null)
  const lastSeenId = useRef(null)
  const ref = useRef(null)
  const navigate = useNavigate()

  const load = useCallback(async () => {
    try {
      const d = await api.get('/notifications')
      const newest = d.items[0]
      if (lastSeenId.current !== null && newest && newest.id > lastSeenId.current && !newest.is_read) {
        setToast(newest)
        setTimeout(() => setToast(null), 6000)
      }
      if (newest) lastSeenId.current = Math.max(lastSeenId.current ?? 0, newest.id)
      else if (lastSeenId.current === null) lastSeenId.current = 0
      setData(d)
    } catch { /* offline or signed out */ }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, POLL_MS)
    window.addEventListener('notifications:refresh', load)
    return () => { clearInterval(t); window.removeEventListener('notifications:refresh', load) }
  }, [load])

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  const openItem = async (n) => {
    setOpen(false); setToast(null)
    if (!n.is_read) { await api.post(`/notifications/${n.id}/read`); load() }
    if (n.link) navigate(n.link)
  }
  const readAll = async () => { await api.post('/notifications/read-all'); load() }

  return (
    <div className="bell-wrap" ref={ref}>
      <button className="bell" onClick={() => setOpen(!open)} aria-label={`Notifications, ${data.unread} unread`}>
        🔔{data.unread > 0 && <span className="bell-count">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="bell-panel">
          <div className="bell-head">
            <strong>Notifications</strong>
            {data.unread > 0 && <button className="linkish" onClick={readAll}>Mark all read</button>}
          </div>
          {data.items.length === 0 && <div className="bell-empty">You're all caught up.</div>}
          {data.items.slice(0, 8).map((n) => (
            <button key={n.id} className={`bell-item ${n.is_read ? '' : 'unread'}`} onClick={() => openItem(n)}>
              <span className="bell-icon">{TYPE_ICON[n.type] || '•'}</span>
              <span className="bell-body">
                <span className="bell-title">{n.title}</span>
                <span className="bell-msg">{n.message}</span>
                <span className="bell-time">{timeAgo(n.created_at)}</span>
              </span>
            </button>
          ))}
          <Link to={viewAllPath} className="bell-all" onClick={() => setOpen(false)}>View all notifications</Link>
        </div>
      )}
      {toast && (
        <button className="toast" onClick={() => openItem(toast)}>
          <span className="bell-icon">{TYPE_ICON[toast.type] || '•'}</span>
          <span className="bell-body"><span className="bell-title">{toast.title}</span><span className="bell-msg">{toast.message}</span></span>
        </button>
      )}
    </div>
  )
}
