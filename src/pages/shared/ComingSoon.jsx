import { useLocation, Link } from 'react-router-dom'

export default function ComingSoon({ home }) {
  const { pathname } = useLocation()
  const name = pathname.split('/').filter(Boolean).slice(1).map((s) => s[0].toUpperCase() + s.slice(1)).join(' › ')
  return (
    <div className="card coming-soon">
      <div className="big-icon">🚧</div>
      <h1>{name || 'Page'}</h1>
      <p className="muted">This module is not built yet. It's reserved in the menu for a future release.</p>
      <Link to={home} className="btn secondary">Back to home</Link>
    </div>
  )
}
