import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, fmtDateTime } from '../../api.js'

const TYPE_LABEL = { new_order: 'New order', order_status: 'Order update', low_stock: 'Stock alert', customer: 'Customer', info: 'Info' }

export default function Notifications() {
  const [data, setData] = useState({ unread: 0, items: [] })
  const [filter, setFilter] = useState('all')
  const navigate = useNavigate()

  const load = useCallback(() => api.get('/notifications').then(setData), [])
  useEffect(() => { load() }, [load])
  const refreshBell = () => window.dispatchEvent(new Event('notifications:refresh'))

  const open = async (n) => {
    if (!n.is_read) { await api.post(`/notifications/${n.id}/read`); refreshBell() }
    if (n.link) navigate(n.link); else load()
  }
  const readAll = async () => { await api.post('/notifications/read-all'); refreshBell(); load() }

  const types = [...new Set(data.items.map((n) => n.type))]
  const items = data.items.filter((n) => filter === 'all' || (filter === 'unread' ? !n.is_read : n.type === filter))

  return (
    <div>
      <div className="page-header">
        <h1>Notifications</h1>
        {data.unread > 0 && <button className="btn secondary" onClick={readAll}>Mark all as read ({data.unread})</button>}
      </div>
      <div className="chips">
        {['all', 'unread', ...types].map((t) => (
          <button key={t} className={`chip ${filter === t ? 'on' : ''}`} onClick={() => setFilter(t)}>
            {t === 'all' ? 'All' : t === 'unread' ? 'Unread' : TYPE_LABEL[t] || t}
          </button>
        ))}
      </div>
      <div className="card flush">
        {items.length === 0 && <div className="empty">Nothing here.</div>}
        {items.map((n) => (
          <button key={n.id} className={`notif-row ${n.is_read ? '' : 'unread'}`} onClick={() => open(n)}>
            <span className="notif-dot" aria-hidden="true" />
            <span className="notif-main">
              <span className="notif-title">{n.title}</span>
              <span className="muted">{n.message}</span>
            </span>
            <span className="notif-meta">
              <span className="tag">{TYPE_LABEL[n.type] || n.type}</span>
              <span className="muted small">{fmtDateTime(n.created_at)}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
