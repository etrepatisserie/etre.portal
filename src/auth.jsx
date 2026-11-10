import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { api, getToken, setToken, setUnauthorizedHandler } from './api.js'

const AuthContext = createContext(null)
export const useAuth = () => useContext(AuthContext)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(Boolean(getToken()))

  const clear = useCallback(() => { setToken(null); setUser(null) }, [])

  useEffect(() => {
    setUnauthorizedHandler(clear)
    if (!getToken()) return
    api.get('/auth/me').then(setUser).catch(clear).finally(() => setLoading(false))
  }, [clear])

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password })
    setToken(res.token)
    setUser(res.user)
    return res.user
  }
  const logout = async () => {
    try { await api.post('/auth/logout') } catch { /* already gone */ }
    clear()
  }

  return <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
}
