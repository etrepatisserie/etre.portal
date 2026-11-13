import { useState } from 'react'
import { fmtDay } from '../api.js'
import Icon from './Icon.jsx'
import { NOTICE_ICON } from '../icons.js'


// Compact notices at the top of the customer portal: one line each, "Read more" for details
export default function AnnouncementBanner({ items }) {
  const [hidden, setHidden] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('hidden_announcements') || '[]') } catch { return [] }
  })
  const [open, setOpen] = useState(null)
  // closures first — they affect which dates can be chosen
  const shown = items.filter((a) => !hidden.includes(a.id)).sort((a, b) => (a.type === 'closure' ? -1 : 0) - (b.type === 'closure' ? -1 : 0))
  if (!shown.length) return null
  const hide = (id) => {
    const next = [...hidden, id]
    setHidden(next)
    try { sessionStorage.setItem('hidden_announcements', JSON.stringify(next)) } catch { /* ignore */ }
  }
  return (
    <section className="announcements" aria-label="Announcements">
      {shown.map((a) => (
        <div key={a.id} className={`announcement ${a.type}`}>
          <span className="ann-icon"><Icon name={NOTICE_ICON[a.type] || 'Megaphone'} size={18} /></span>
          <div className="ann-body">
            <strong>{a.title}</strong>
            {a.type === 'closure' && <span className="ann-dates">Closed {fmtDay(a.closure_from)}{a.closure_to !== a.closure_from ? ` – ${fmtDay(a.closure_to)}` : ''}</span>}
            {a.body && <button className="ann-more" onClick={() => setOpen(open === a.id ? null : a.id)}>{open === a.id ? 'Less' : 'Read more'}</button>}
            {open === a.id && <div className="ann-full">{a.body}</div>}
          </div>
          <button className="ann-close" onClick={() => hide(a.id)} aria-label="Hide this notice" title="Hide this notice"><Icon name="X" size={16} /></button>
        </div>
      ))}
    </section>
  )
}
