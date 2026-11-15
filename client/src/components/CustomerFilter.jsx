import { useEffect, useState } from 'react'
import { api } from '../api.js'
import Icon from './Icon.jsx'

// Filter by customer company: type part of the name, or pick it from the drop-down list
export default function CustomerFilter({ value, onChange }) {
  const [names, setNames] = useState([])
  useEffect(() => { api.get('/finance/customers').then((rows) => setNames(rows.map((c) => c.name).sort())).catch(() => {}) }, [])
  return (
    <div className="customer-filter">
      <label htmlFor="customer-filter-input"><Icon name="Filter" size={16} /> Customer</label>
      <input id="customer-filter-input" list="customer-filter-list" value={value} onChange={(e) => onChange(e.target.value)}
        placeholder="All customers — type or pick" autoComplete="off" />
      <datalist id="customer-filter-list">{names.map((n) => <option key={n} value={n} />)}</datalist>
      {value && <button type="button" className="linkish" onClick={() => onChange('')}><Icon name="X" size={14} /> Clear</button>}
    </div>
  )
}

// true when the customer name matches what was typed / picked (case-insensitive, partial)
export const matchesCustomer = (name, filter) => !filter.trim() || String(name || '').toLowerCase().includes(filter.trim().toLowerCase())
