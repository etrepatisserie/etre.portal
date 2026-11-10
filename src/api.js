// Fetch wrapper: adds the session token and turns errors into exceptions.
const TOKEN_KEY = 'erp_token'
let token = null
try { token = localStorage.getItem(TOKEN_KEY) } catch { /* storage unavailable */ }
let onUnauthorized = () => {}

export const getToken = () => token
export function setToken(t) {
  token = t
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
}
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn }

async function request(method, url, body) {
  const headers = {}
  if (body) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`/api${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && url !== '/auth/login') onUnauthorized()
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`)
  return data
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body ?? {}),
  put: (url, body) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
}

// ---------- formatting helpers ----------
export const money = (n) => `RM ${Number(n || 0).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const compactMoney = (n) => 'RM ' + Intl.NumberFormat('en-MY', { notation: 'compact', maximumFractionDigits: 1 }).format(n || 0)
export const num = (n) => Number(n || 0).toLocaleString()
export const today = () => new Date().toISOString().slice(0, 10)
// server timestamps are UTC "YYYY-MM-DD HH:MM:SS"
const parse = (s) => new Date(s.length <= 10 ? `${s}T00:00:00` : `${s.replace(' ', 'T')}Z`)
export const fmtDate = (s) => (s ? parse(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
export const fmtDateTime = (s) => (s ? parse(s).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—')
export function timeAgo(s) {
  const sec = (Date.now() - parse(s).getTime()) / 1000
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d ago`
  return fmtDate(s)
}
