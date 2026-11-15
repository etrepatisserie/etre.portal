import { useEffect, useRef, useState } from 'react'
import Icon from './Icon.jsx'

// Lightweight SVG/HTML charts — no chart library needed.
// Single-series charts: one hue (--series-1), no legend (the card title names the series),
// thin bars with a 4px rounded data-end, hairline gridlines, hover tooltip, and a table view.

function useWidth() {
  const ref = useRef(null)
  const [w, setW] = useState(600)
  useEffect(() => {
    if (!ref.current) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

function niceTicks(max, count = 4) {
  if (max <= 0) return [0, 1]
  const raw = max / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)
  const ticks = []
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v)
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step)
  return ticks
}

// Bar path: square at the baseline, 4px rounded at the data end (top)
function columnPath(x, y, w, h, r = 4) {
  if (h <= 0) return ''
  r = Math.min(r, h, w / 2)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

export function ColumnChart({ data, format = String, axisFormat = format, height = 240, highlightLast = false }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const m = { top: 20, right: 8, bottom: 28, left: 52 }
  const iw = Math.max(width - m.left - m.right, 50)
  const ih = height - m.top - m.bottom
  const ticks = niceTicks(Math.max(...data.map((d) => d.value || 0), 0))
  const top = ticks[ticks.length - 1]
  const band = iw / data.length
  const barW = Math.min(24, band * 0.6)
  const y = (v) => ih - ((v || 0) / top) * ih
  const maxIdx = data.reduce((best, d, i) => ((d.value || 0) > (data[best].value || 0) ? i : best), 0)

  return (
    <div className="chart" ref={ref}>
      <svg width={width} height={height} role="img" aria-label="Column chart">
        <g transform={`translate(${m.left},${m.top})`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={iw} y1={y(t)} y2={y(t)} className="grid" />
              <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" className="axis-text">{axisFormat(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x = i * band + (band - barW) / 2
            const active = hover === i
            return (
              <g key={d.label}>
                <path d={columnPath(x, y(d.value), barW, ih - y(d.value))}
                  className={`bar ${hover !== null && !active ? 'dim' : ''} ${highlightLast && i === data.length - 1 ? 'partial' : ''}`} />
                {i === maxIdx && d.value > 0 && (
                  <text x={x + barW / 2} y={y(d.value) - 6} textAnchor="middle" className="value-text">{axisFormat(d.value)}</text>
                )}
                <text x={i * band + band / 2} y={ih + 18} textAnchor="middle" className="axis-text">{d.label}</text>
                {/* hit target: the whole band, taller than the bar */}
                <rect x={i * band} y={0} width={band} height={ih} fill="transparent"
                  onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
              </g>
            )
          })}
          <line x1={0} x2={iw} y1={ih} y2={ih} className="baseline" />
        </g>
      </svg>
      {hover !== null && (
        <div className="tooltip" style={{ left: m.left + hover * band + band / 2, top: m.top + y(data[hover].value) }}>
          <div className="tooltip-title">{data[hover].fullLabel || data[hover].label}</div>
          <div className="tooltip-value">{data[hover].value == null ? 'No data' : format(data[hover].value)}</div>
          {data[hover].sub && <div className="tooltip-sub">{data[hover].sub}</div>}
        </div>
      )}
    </div>
  )
}

// Two (or a few) series side by side per category, e.g. invoiced vs collected per month.
// Fixed categorical order (--series-1, --series-2, …), legend always shown, 2px surface gap between bars.
export function GroupedColumnChart({ data, series, format = String, axisFormat = format, height = 260, highlightLast = false }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const m = { top: 20, right: 8, bottom: 28, left: 52 }
  const iw = Math.max(width - m.left - m.right, 50)
  const ih = height - m.top - m.bottom
  const ticks = niceTicks(Math.max(...data.flatMap((d) => d.values.map((v) => v || 0)), 0))
  const top = ticks[ticks.length - 1]
  const band = iw / data.length
  const gap = 2
  const barW = Math.max(3, Math.min(18, (band * 0.7 - gap * (series.length - 1)) / series.length))
  const groupW = barW * series.length + gap * (series.length - 1)
  const y = (v) => ih - ((v || 0) / top) * ih // null = no data: no bar
  return (
    <div className="chart" ref={ref}>
      <div className="legend">{series.map((s, k) => <span key={s.name} className="legend-item"><span className={`legend-swatch s${k + 1}`} />{s.name}</span>)}</div>
      <svg width={width} height={height} role="img" aria-label={`Column chart: ${series.map((s) => s.name).join(' and ')}`}>
        <g transform={`translate(${m.left},${m.top})`}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={0} x2={iw} y1={y(t)} y2={y(t)} className="grid" />
              <text x={-8} y={y(t)} dy="0.32em" textAnchor="end" className="axis-text">{axisFormat(t)}</text>
            </g>
          ))}
          {data.map((d, i) => {
            const x0 = i * band + (band - groupW) / 2
            return (
              <g key={d.label}>
                {d.values.map((v, k) => (
                  <path key={k} d={columnPath(x0 + k * (barW + gap), y(v), barW, ih - y(v))}
                    className={`bar s${k + 1} ${hover !== null && hover !== i ? 'dim' : ''} ${highlightLast && i === data.length - 1 ? 'partial' : ''}`} />
                ))}
                <text x={i * band + band / 2} y={ih + 18} textAnchor="middle" className="axis-text">{d.label}</text>
                <rect x={i * band} y={0} width={band} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
              </g>
            )
          })}
          <line x1={0} x2={iw} y1={ih} y2={ih} className="baseline" />
        </g>
      </svg>
      {hover !== null && (
        <div className="tooltip" style={{ left: m.left + hover * band + band / 2, top: m.top + y(Math.max(...data[hover].values.map((v) => v || 0))) + 24 }}>
          <div className="tooltip-title">{data[hover].fullLabel || data[hover].label}</div>
          {series.map((s, k) => <div key={s.name} className="tooltip-row"><span className={`legend-swatch s${k + 1}`} />{s.name} <strong>{data[hover].values[k] == null ? 'no data' : format(data[hover].values[k])}</strong></div>)}
          {data[hover].sub && <div className="tooltip-sub">{data[hover].sub}</div>}
        </div>
      )}
    </div>
  )
}

// Horizontal ranked bars (HTML) — good for top-N lists with long labels
export function BarList({ data, format = String }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(...data.map((d) => d.value), 0) || 1
  if (data.length === 0) return <div className="empty"><Icon name="BarChart3" size={24} className="empty-icon" />No data for this period.</div>
  return (
    <div className="barlist">
      {data.map((d, i) => (
        <div key={d.label} className={`barlist-row ${hover !== null && hover !== i ? 'dim' : ''}`}
          onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
          <div className="barlist-label" title={d.label}>{d.label}</div>
          <div className="barlist-track">
            <div className="barlist-bar" style={{ width: `${Math.max((d.value / max) * 100, 0.5)}%` }} />
            {hover === i && d.sub && <div className="tooltip inline-tip">{d.sub}</div>}
          </div>
          <div className="barlist-value">{format(d.value)}</div>
        </div>
      ))}
    </div>
  )
}

// Card wrapper with a Chart / Table toggle so values are never available only as color/shape
export function ChartCard({ title, subtitle, columns, rows, children }) {
  const [view, setView] = useState('chart')
  return (
    <div className="card chart-card">
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <div className="muted small">{subtitle}</div>}
        </div>
        <div className="segmented small">
          <button className={view === 'chart' ? 'on' : ''} onClick={() => setView('chart')}>Chart</button>
          <button className={view === 'table' ? 'on' : ''} onClick={() => setView('table')}>Table</button>
        </div>
      </div>
      {view === 'chart' ? children : (
        <div className="table-wrap">
          <table>
            <thead><tr>{columns.map((c, i) => <th key={c} className={i > 0 ? 'num' : ''}>{c}</th>)}</tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}>{r.map((v, j) => <td key={j} className={j > 0 ? 'num' : ''}>{v}</td>)}</tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  )
}
