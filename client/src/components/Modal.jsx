import { useEffect, useRef } from 'react'
import Icon from './Icon.jsx'

// Accessible modal dialog: Esc and the backdrop close it, focus moves inside and returns afterwards.
export default function Modal({ title, icon, iconClass = '', onClose, children, actions, wide = false, labelledBy = 'modal-title' }) {
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })
  useEffect(() => {
    const before = document.activeElement
    const first = ref.current?.querySelector('[data-autofocus], button, [href], input, select, textarea')
    first?.focus()
    const onKey = (e) => {
      if (e.key === 'Escape') closeRef.current?.()
      if (e.key === 'Tab' && ref.current) { // keep focus inside the dialog
        const f = [...ref.current.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select, textarea')]
        if (!f.length) return
        if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus() }
        else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); before?.focus?.() }
  }, [])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={ref}>
        {title && <h2 className="modal-title" id={labelledBy}>{icon && <Icon name={icon} size={20} className={iconClass} />}{title}</h2>}
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>
  )
}
