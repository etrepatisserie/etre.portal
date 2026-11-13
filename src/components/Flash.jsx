import { useEffect, useRef } from 'react'
import { useToast } from '../feedback.js'
import Icon from './Icon.jsx'

// Result of an action. msg is a string (success) or { ok, text }.
// Success → toast (and stays on the page too when `keep` is set, e.g. customer-facing confirmations).
// Error   → toast and an inline alert next to the action, so it isn't missed.
export default function Flash({ msg, keep = false, className = '' }) {
  const toast = useToast()
  const m = msg == null || msg === '' ? null : typeof msg === 'string' ? { ok: true, text: msg } : msg
  const last = useRef(null)
  useEffect(() => {
    if (msg == null || msg === '' || last.current === msg) return
    last.current = msg
    const r = typeof msg === 'string' ? { ok: true, text: msg } : msg
    if (r.ok) toast.success(r.text); else toast.error(r.text)
  }, [msg, toast])
  if (!m || (m.ok && !keep)) return null
  return <div className={`alert ${m.ok ? 'success' : 'error'} ${className}`} role={m.ok ? 'status' : 'alert'}><Icon name={m.ok ? 'CircleCheck' : 'AlertCircle'} size={18} /><span>{m.text}</span></div>
}
