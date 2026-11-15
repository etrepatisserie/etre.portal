import { useState } from 'react'
import { openFile, downloadFile } from '../api.js'
import Icon from './Icon.jsx'

// Opens / downloads a protected file (the API needs the login token, so a plain <a href> won't work)
export default function FileLink({ url, filename, children, download = false, className = 'linkish' }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const go = async (e) => {
    e.preventDefault(); setBusy(true); setErr('')
    try { download ? await downloadFile(`${url}${url.includes('?') ? '&' : '?'}download=1`, filename) : await openFile(url) }
    catch (x) { setErr(x.message) } finally { setBusy(false) }
  }
  return (
    <>
      <button type="button" className={className} onClick={go} disabled={busy}>{busy ? 'Opening…' : <>{download && <Icon name="Download" size={16} />}{children}</>}</button>
      {err && <span className="neg small"> {err}</span>}
    </>
  )
}
