import { useEffect, useState } from 'react'
import { api } from '../api.js'

// Generic list + "add new" form for simple master-data tables (suppliers, products, …)
export default function MasterDataPage({ title, endpoint, fields, columns, headerActions, intro, reloadKey = 0 }) {
  const blank = Object.fromEntries(fields.map((f) => [f.name, f.default ?? '']))
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(blank)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { api.get(endpoint).then(setRows) }, [endpoint, reloadKey])

  const save = async (e) => {
    e.preventDefault(); setError('')
    try {
      const created = await api.post(endpoint, form)
      setRows([...rows, created]); setForm(blank); setShowForm(false)
    } catch (err) { setError(err.message) }
  }

  return (
    <div>
      <div className="page-header">
        <h1>{title}</h1>
        <div className="actions inline">
          {headerActions}
          <button className="btn primary" onClick={() => setShowForm(!showForm)}>{showForm ? 'Close' : `+ Add`}</button>
        </div>
      </div>

      {intro}

      {showForm && (
        <form className="card" onSubmit={save}>
          {error && <div className="alert error">{error}</div>}
          <div className="grid-form">
            {fields.map((f) => (
              <label key={f.name}>{f.label}{f.required && ' *'}
                {f.options
                  ? <select value={form[f.name]} onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}>{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
                  : <input type={f.type || 'text'} step={f.step} value={form[f.name]} required={f.required}
                      onChange={(e) => setForm({ ...form, [f.name]: e.target.value })} />}
              </label>
            ))}
          </div>
          <div className="actions"><button className="btn primary" type="submit">Save</button></div>
        </form>
      )}

      <div className="card">
        <div className="table-wrap">
          <table>
            <thead><tr>{columns.map((c) => <th key={c.key} className={c.num ? 'num' : ''}>{c.label}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  {columns.map((c) => <td key={c.key} className={c.num ? 'num' : ''}>{c.render ? c.render(r) : r[c.key] || '—'}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
