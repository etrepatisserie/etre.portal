import { toneOf } from '../status.js'
import Icon from './Icon.jsx'

// The one thing to know on an order page: what happens next, who does it, and the button to press.
// kind: 'you' (your action) · 'wait' (someone else) · 'done'
export default function NextStep({ status, tone, kind = 'you', who, title, children, actions }) {
  const label = kind === 'you' ? 'Your next step' : kind === 'done' ? 'Done' : `Waiting for ${who || 'others'}`
  return (
    <section className={`next-step tone-${tone || toneOf(status)} ${kind}`} aria-live="polite">
      <div className="next-label"><Icon name={kind === 'you' ? 'Hand' : kind === 'done' ? 'CircleCheck' : 'Hourglass'} size={16} /> {label}</div>
      <div className="next-title">{title}</div>
      {children && <div className="next-text">{children}</div>}
      {actions && <div className="next-actions">{actions}</div>}
    </section>
  )
}
