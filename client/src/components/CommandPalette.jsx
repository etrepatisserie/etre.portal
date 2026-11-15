import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from './Icon.jsx'
import { flattenMenu } from '../menus.js'

// ⌘K / Ctrl-K: jump to any page or action in this portal's menu. Frontend only — it searches the menu, not records.
export default function CommandPalette({ menu, extra = [], open, onClose }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [i, setI] = useState(0)
  const input = useRef(null)
  const all = useMemo(() => [...flattenMenu(menu), ...extra], [menu, extra])
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = all.filter((x) => words.every((w) => `${x.group} ${x.label}`.toLowerCase().includes(w))).slice(0, 12)
  const sel = Math.min(i, Math.max(shown.length - 1, 0))

  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 0) }, [open])
  if (!open) return null
  const go = (x) => { onClose(); setQ(''); setI(0); navigate(x.to) }
  const onKey = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setI((sel + 1) % Math.max(shown.length, 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setI((sel - 1 + shown.length) % Math.max(shown.length, 1)) }
    else if (e.key === 'Enter' && shown[sel]) { e.preventDefault(); go(shown[sel]) }
    else if (e.key === 'Escape') onClose()
  }
  return (
    <div className="modal-backdrop palette-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Go to page">
        <div className="palette-input">
          <Icon name="Search" size={18} />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setI(0) }} onKeyDown={onKey}
            placeholder="Go to a page or action…" aria-label="Go to a page or action" role="combobox" aria-expanded="true" aria-controls="palette-list"
            aria-activedescendant={shown[sel] ? `pal-${sel}` : undefined} />
          <kbd>Esc</kbd>
        </div>
        <ul className="palette-list" id="palette-list" role="listbox">
          {shown.length === 0 && <li className="palette-empty">No page matches “{q}”.</li>}
          {shown.map((x, n) => (
            <li key={x.to} id={`pal-${n}`} role="option" aria-selected={n === sel} className={n === sel ? 'on' : ''}
              onMouseEnter={() => setI(n)} onMouseDown={(e) => { e.preventDefault(); go(x) }}>
              <Icon name={x.icon || 'ArrowRight'} size={16} />
              <span className="palette-label">{x.label}</span>
              {x.group && <span className="palette-group">{x.group}</span>}
            </li>
          ))}
        </ul>
        <div className="palette-foot small muted"><kbd>↑</kbd><kbd>↓</kbd> to move · <kbd>Enter</kbd> to open</div>
      </div>
    </div>
  )
}
