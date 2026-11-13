import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { getSelectedOutlet } from '../outlet.js'
import Icon from './Icon.jsx'

// Outlet choice inside a form. Outlet staff: fixed to their outlet. Head office: pick one
// (or "Both outlets" when allowBoth, e.g. announcements). Value is an outlet id string ('' = both / not chosen).
export default function OutletField({ value, onChange, allowBoth = false }) {
  const { user } = useAuth()
  const [outlets, setOutlets] = useState([])
  useEffect(() => { api.get('/outlets').then(setOutlets).catch(() => {}) }, [])
  useEffect(() => {
    // default to the outlet picked in the menu bar
    if (user?.head_office && !value && getSelectedOutlet() && !allowBoth) onChange(getSelectedOutlet())
  }, [user]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!user) return null
  if (!user.head_office) return <label>Outlet<div className="fixed-value"><Icon name="Building2" size={16} /> {user.outlet_name}</div></label>
  return (
    <label>Outlet {!allowBoth && '*'}
      <select value={value || ''} onChange={(e) => onChange(e.target.value)} required={!allowBoth}>
        <option value="">{allowBoth ? 'Both outlets' : '— Choose KL or Ipoh —'}</option>
        {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  )
}

// For pages that change one outlet's stock: head office must pick an outlet in the menu bar first
export function useNeedsOutlet() {
  const { user } = useAuth()
  return Boolean(user?.head_office && !getSelectedOutlet())
}
