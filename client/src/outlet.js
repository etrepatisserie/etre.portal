import { useEffect, useState } from 'react'

// The outlet a head-office user is looking at (stored per browser). Outlet staff and customers
// are always limited to their own outlet by the server, whatever this says.
const KEY = 'erp_outlet'
export function getSelectedOutlet() {
  try { return localStorage.getItem(KEY) || '' } catch { return '' }
}
export function setSelectedOutlet(id) {
  try { if (id) localStorage.setItem(KEY, String(id)); else localStorage.removeItem(KEY) } catch { /* storage unavailable */ }
  window.dispatchEvent(new Event('outlet:change'))
}
export const outletLabel = (code) => (code === 'IPH' ? 'Ipoh' : code)

// Re-renders when the selected outlet changes (company tabs in Finance)
export function useSelectedOutlet() {
  const [id, setId] = useState(getSelectedOutlet())
  useEffect(() => {
    const on = () => setId(getSelectedOutlet())
    window.addEventListener('outlet:change', on)
    return () => window.removeEventListener('outlet:change', on)
  }, [])
  return id
}
