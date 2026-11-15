import { useEffect, useState } from 'react'
import { api, fmtDateTime } from '../../api.js'
import StatusBadge from '../../components/StatusBadge.jsx'
import Icon from '../../components/Icon.jsx'
import { PageSkeleton } from '../../components/Skeleton.jsx'
import { outletLabel } from '../../outlet.js'

// Finance → Invoices → Bukku activity: is Bukku on and set up for each company, and every call made.
export default function BukkuLog() {
  const [d, setD] = useState(null)
  useEffect(() => { api.get('/finance/integration-log').then(setD) }, [])
  if (!d) return <PageSkeleton cards={2} rows={6} />
  return (
    <div>
      <div className="page-header"><div><h1>Bukku activity</h1><div className="muted">Each company has its own Bukku account. Credentials are kept on the server only.</div></div></div>
      <div className="kpis">{Object.entries(d.status).map(([code, st]) => (
        <div key={code} className={`stat tone-${st.ready ? 'green' : 'gray'}`}><div className="stat-label">{outletLabel(code)}</div>
          <div className="stat-value" style={{ fontSize: '1.15rem' }}>{st.ready ? 'Connected' : st.enabled ? 'Not set up' : 'Switched off'}</div>
          <div className="stat-sub">{st.ready ? 'Invoices can be created in Bukku' : st.enabled ? 'Add the API token and company subdomain on the server' : 'Turn on with BUKKU_ENABLED once tested'}</div></div>
      ))}</div>
      <div className="card flush"><div className="table-wrap"><table>
        <thead><tr><th>When</th><th>Company</th><th>Invoice</th><th>Result</th><th>Details</th><th>By</th></tr></thead>
        <tbody>{d.log.length === 0 ? <tr><td colSpan="6" className="empty"><Icon name="Inbox" size={24} className="empty-icon" />No Bukku activity yet.</td></tr>
          : d.log.map((l) => <tr key={l.id}><td>{fmtDateTime(l.created_at)}</td><td>{l.outlet_code}</td><td className="mono">{l.inv_number || '—'}</td>
            <td><StatusBadge status={l.status === 'ok' ? 'sent' : l.status === 'error' ? 'failed' : 'Expired'} label={l.status === 'ok' ? 'Sent' : l.status === 'error' ? 'Failed' : 'Skipped'} /></td>
            <td className="small">{l.message}{l.http_status ? ` (HTTP ${l.http_status})` : ''}</td><td className="small muted">{l.user_name || '—'}</td></tr>)}</tbody>
      </table></div></div>
    </div>
  )
}
