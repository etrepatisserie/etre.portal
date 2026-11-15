import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { setSelectedOutlet, useSelectedOutlet } from '../outlet.js'

// Finance works for two separate companies from one login: pick the company's books here.
// Every finance page (lists, filters, reports, downloads) follows this choice.
export default function CompanyTabs() {
  const { user } = useAuth()
  const selected = useSelectedOutlet()
  const [outlets, setOutlets] = useState([])
  useEffect(() => { if (user?.head_office) api.get('/outlets').then(setOutlets).catch(() => {}) }, [user])
  if (!user?.head_office || !outlets.length) return null
  const tabs = [...outlets.map((o) => ({ id: String(o.id), code: o.code, label: o.code === 'IPH' ? 'Ipoh' : o.code, sub: o.name })), { id: '', code: 'both', label: 'Both companies', sub: 'shown side by side' }]
  return (
    <div className="company-tabs" role="tablist" aria-label="Company">
      {tabs.map((t) => (
        <button key={t.code} role="tab" aria-selected={selected === t.id} className={`company-tab co-${t.code.toLowerCase()} ${selected === t.id ? 'on' : ''}`}
          onClick={() => setSelectedOutlet(t.id)}>
          <span className="company-dot" aria-hidden="true" />
          <span className="company-tab-label">{t.label}</span>
          <span className="company-tab-sub">{t.code === 'both' ? 'side by side' : t.sub}</span>
        </button>
      ))}
    </div>
  )
}
