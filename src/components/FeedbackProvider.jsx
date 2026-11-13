import { useCallback, useMemo, useRef, useState } from 'react'
import { FeedbackContext } from '../feedback.js'
import Modal from './Modal.jsx'
import Icon from './Icon.jsx'

const TOAST = { success: ['green', 'CircleCheck'], error: ['red', 'AlertCircle'], info: ['blue', 'Info'] }

// Holds the toast stack and the confirm dialog for the whole app (see src/feedback.js for the hooks)
export default function FeedbackProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const [ask, setAsk] = useState(null) // { title, body, confirmLabel, cancelLabel, danger, resolve }
  const seq = useRef(0)

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  const push = useCallback((kind, text, ms) => {
    const id = ++seq.current
    setToasts((t) => [...t.slice(-3), { id, kind, text }])
    setTimeout(() => dismiss(id), ms ?? (kind === 'error' ? 8000 : 4500))
  }, [dismiss])
  const toast = useMemo(() => ({
    success: (t, ms) => push('success', t, ms), error: (t, ms) => push('error', t, ms), info: (t, ms) => push('info', t, ms),
  }), [push])
  const confirm = useCallback((opts) => new Promise((resolve) => setAsk({ ...opts, resolve })), [])
  const close = (ok) => { ask?.resolve(ok); setAsk(null) }
  const value = useMemo(() => ({ toast, confirm }), [toast, confirm])

  return (
    <FeedbackContext.Provider value={value}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast-msg tone-${TOAST[t.kind][0]}`}>
            <Icon name={TOAST[t.kind][1]} size={18} />
            <div className="toast-text">{t.text}</div>
            <button type="button" className="icon-btn" onClick={() => dismiss(t.id)} aria-label="Dismiss" title="Dismiss"><Icon name="X" size={16} /></button>
          </div>
        ))}
      </div>
      {ask && (
        <Modal title={ask.title} icon={ask.danger ? 'AlertTriangle' : 'Info'} iconClass={ask.danger ? 'danger' : ''} onClose={() => close(false)} labelledBy="confirm-title"
          actions={<>
            <button type="button" className="btn secondary" onClick={() => close(false)}>{ask.cancelLabel || 'Go back'}</button>
            <button type="button" className={`btn ${ask.danger ? 'danger solid' : 'primary'}`} data-autofocus onClick={() => close(true)}>{ask.confirmLabel || 'Confirm'}</button>
          </>}>
          {ask.body}
        </Modal>
      )}
    </FeedbackContext.Provider>
  )
}
