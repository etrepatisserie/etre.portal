// Loading placeholders. <Skeleton w="60%" h={14} /> for one line; <PageSkeleton /> while a page loads.
export default function Skeleton({ w = '100%', h = 14, r, style }) {
  return <span className="skeleton" aria-hidden="true" style={{ width: w, height: h, borderRadius: r, ...style }} />
}

export function PageSkeleton({ cards = 4, rows = 6 }) {
  return (
    <div className="skeleton-page" role="status" aria-label="Loading">
      <Skeleton w="34%" h={28} />
      <div className="stats">{Array.from({ length: cards }, (_, i) => <div key={i} className="stat"><Skeleton w="50%" h={12} /><Skeleton w="70%" h={26} style={{ marginTop: 10 }} /></div>)}</div>
      <div className="card">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} h={16} style={{ margin: '10px 0' }} w={`${88 - (i % 3) * 12}%`} />)}</div>
    </div>
  )
}
