// Fetch wrapper: adds the session token (+ head office's chosen outlet) and turns errors into exceptions.
import { getSelectedOutlet } from './outlet.js'
const TOKEN_KEY = 'erp_token'
let token = null
try { token = localStorage.getItem(TOKEN_KEY) } catch { /* storage unavailable */ }
let onUnauthorized = () => {}

export const getToken = () => token
export function setToken(t) {
  token = t
  try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
}
const authHeaders = () => ({ ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(getSelectedOutlet() ? { 'X-Outlet': getSelectedOutlet() } : {}) })
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn }

async function request(method, url, body) {
  const headers = {}
  if (body) headers['Content-Type'] = 'application/json'
  if (token) headers.Authorization = `Bearer ${token}`
  if (getSelectedOutlet()) headers['X-Outlet'] = getSelectedOutlet()
  const res = await fetch(`/api${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401 && url !== '/auth/login') onUnauthorized()
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`)
    err.data = data // e.g. { blocked: true, invoices: [...] }
    throw err
  }
  return data
}

// multipart/form-data upload (files + fields)
export async function upload(url, formData) {
  const res = await fetch(`/api${url}`, { method: 'POST', headers: authHeaders(), body: formData })
  const data = await res.json().catch(() => ({}))
  if (res.status === 401) onUnauthorized()
  if (!res.ok) { const err = new Error(data.error || `Upload failed (${res.status})`); err.data = data; throw err }
  return data
}

// Protected files (invoices, DOs, slips, reports) need the token, so fetch them as a blob
export async function fetchBlob(url) {
  const res = await fetch(`/api${url}`, { headers: authHeaders() })
  if (res.status === 401) onUnauthorized()
  if (!res.ok) { const data = await res.json().catch(() => ({})); throw new Error(data.error || `Could not open file (${res.status})`) }
  return res.blob()
}
export async function openFile(url) {
  const blob = await fetchBlob(url)
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href; a.target = '_blank'; a.rel = 'noopener'
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 60000)
}
export async function downloadFile(url, filename) {
  const blob = await fetchBlob(url)
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href; a.download = filename
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(href), 60000)
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
export const num = (n) => Number(n || 0).toLocaleString('en-MY')
export const today = () => new Date().toISOString().slice(0, 10)
// today's date in Malaysia (YYYY-MM-DD)
export const todayMY = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
// server timestamps are UTC "YYYY-MM-DD HH:MM:SS"; plain dates are "YYYY-MM-DD"
const parse = (s) => new Date(s.length <= 10 ? `${s}T00:00:00Z` : `${s.replace(' ', 'T')}Z`)
// One date style everywhere, fixed (not the browser's locale), shown in Malaysia time:
//   fmtDate "12 Nov 2026" · fmtDay "Thu 12 Nov 2026" (pickup / delivery / production days) · fmtDateTime "12 Nov 2026, 2:05 pm"
const TZ = (s) => (s.length <= 10 ? 'UTC' : 'Asia/Kuala_Lumpur')
const part = (d, tz, opt) => new Intl.DateTimeFormat('en-GB', { ...opt, timeZone: tz }).format(d)
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] // fixed — browsers differ ("Sept")
export const fmtDate = (s) => (s ? `${part(parse(s), TZ(s), { day: 'numeric' })} ${MONTHS[Number(part(parse(s), TZ(s), { month: 'numeric' })) - 1]} ${part(parse(s), TZ(s), { year: 'numeric' })}` : '—')
export const fmtDay = (d) => (d ? `${part(parse(d), 'UTC', { weekday: 'short' })} ${fmtDate(d)}` : '—')
export const fmtDayLong = (d) => (d ? `${part(parse(d), 'UTC', { weekday: 'long' })} ${part(parse(d), 'UTC', { day: 'numeric' })} ${part(parse(d), 'UTC', { month: 'long' })} ${part(parse(d), 'UTC', { year: 'numeric' })}` : '—')
export const fmtTime = (s) => (s ? part(parse(s), 'Asia/Kuala_Lumpur', { hour: 'numeric', minute: '2-digit', hour12: true }) : '—')
export const fmtDateTime = (s) => (s ? `${fmtDate(s)}, ${fmtTime(s)}` : '—')
export function timeAgo(s) {
  const sec = (Date.now() - parse(s).getTime()) / 1000
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  if (sec < 86400 * 7) return `${Math.floor(sec / 86400)}d ago`
  return fmtDate(s)
}
