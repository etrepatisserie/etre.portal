import { Link } from 'react-router-dom'
import Icon from './Icon.jsx'

// A to-do card for portal home pages: big number, what to do, one link (or a button via onClick)
export default function Todo({ n, tone, what, hint, to, go, onClick, icon }) {
  const cls = `todo-card tone-${tone} ${n ? '' : 'zero'}`
  const body = <>
    <span className="todo-top"><span className="todo-num">{n}</span>{icon && <Icon name={icon} size={24} className="todo-icon" />}</span>
    <span className="todo-what">{what}</span>
    {hint && <span className="todo-hint">{hint}</span>}
    <span className="todo-go">{n ? <>{go} <Icon name="ArrowRight" size={16} /></> : 'Nothing to do'}</span>
  </>
  return onClick ? <button type="button" className={cls} onClick={onClick}>{body}</button> : <Link to={to} className={cls}>{body}</Link>
}
