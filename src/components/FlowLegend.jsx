import { FLOW, toneOf } from '../status.js'
import { STATUS_ICON } from '../icons.js'
import Icon from './Icon.jsx'

// The whole process on one line: colour, stage, who acts next
export default function FlowLegend({ counts = {}, onPick, active }) {
  const showCounts = Object.keys(counts).length > 0
  return (
    <div className="flow-legend" role="group" aria-label="Order stages — pick one to filter">
      {FLOW.map((f, i) => (
        <button key={f.status} type="button" aria-pressed={active === f.status} className={`flow-chip tone-${toneOf(f.status)} ${active === f.status ? 'on' : ''}`}
          onClick={() => onPick?.(f.status === 'Ready for Pickup' ? 'Dispatched' : f.status)}>
          <span className="flow-no">{i + 1}</span>
          <Icon name={STATUS_ICON[f.status]} size={16} className="flow-icon" />
          <span className="flow-text">
            <strong>{f.label}{showCounts && <span className="flow-count">{counts[f.status] || 0}</span>}</strong>
            <small>{f.who ? `${f.who}: ${f.todo}` : 'Complete'}</small>
          </span>
        </button>
      ))}
    </div>
  )
}
