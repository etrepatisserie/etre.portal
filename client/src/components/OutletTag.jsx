import { useAuth } from '../auth.jsx'
import { getSelectedOutlet, outletLabel } from '../outlet.js'

// true when a head-office user is viewing both outlets → lists show which outlet each row belongs to
export function useShowOutlet() {
  const { user } = useAuth()
  return Boolean(user?.head_office && !getSelectedOutlet())
}

export default function OutletTag({ code }) {
  if (!code) return null
  return <span className={`outlet-tag outlet-${code.toLowerCase()}`}>{outletLabel(code)}</span>
}
