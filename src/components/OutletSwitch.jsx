import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { useAuth } from '../auth.jsx'
import { getSelectedOutlet, setSelectedOutlet } from '../outlet.js'
import Icon from './Icon.jsx'

// Menu-bar outlet indicator. Head office can switch between Both / KL / Ipoh; everyone else sees their outlet.
export default function OutletSwitch() {
  const { user } = useAuth()
  const [outlets, setOutlets] = useState([])
  useEffect(() => { if (user?.head_office) api.get('/outlets').then(setOutlets).catch(() => {}) }, [user])
  if (!user) return null
  if (!user.head_office) return user.outlet_name ? <span className={`outlet-chip outlet-${(user.outlet_code || '').toLowerCase()}`} title="Your outlet"><Icon name="Building2" size={16} /> {user.outlet_name}</span> : null
  return (
    <label className="outlet-switch" title="Head office: choose which outlet to work on">
      <Icon name="Building2" size={18} />
      <select value={getSelectedOutlet()} onChange={(e) => { setSelectedOutlet(e.target.value); window.location.reload() }} aria-label="Outlet">
        <option value="">Both outlets</option>
        {outlets.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  )
}
