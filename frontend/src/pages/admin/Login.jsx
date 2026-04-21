import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'
import { BASE_PATH } from '../../config'

export default function AdminLogin() {
  const { loginAdmin } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch(`${BASE_PATH}/api/admin/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      })
      if (!res.ok) {
        setError('Invalid credentials.')
        return
      }
      const data = await res.json()
      loginAdmin({ accessToken: data.access_token })
      navigate('/admin/dashboard', { replace: true })
    } catch {
      setError('Unable to reach the server. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.page}>
      <div style={s.container} className="fade-in">
        <div style={s.wordmark}>ISDD Portal</div>
        <div style={s.subtitle}>Information Security Due Diligence</div>

        <div className="card" style={s.card}>
          <div style={s.cardHeader}>
            <h1 style={s.title}>Administrator Sign In</h1>
            <p style={s.desc}>Access restricted to the Information Security Team.</p>
          </div>
          <form onSubmit={handleSubmit} style={s.form}>
            <div style={s.field}>
              <label style={s.label} htmlFor="un">Username</label>
              <input
                id="un"
                className="input"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoFocus
                required
                disabled={loading}
              />
            </div>
            <div style={s.field}>
              <label style={s.label} htmlFor="pw">Password</label>
              <input
                id="pw"
                type="password"
                className="input"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                disabled={loading}
              />
            </div>
            {error && <div style={s.error}>{error}</div>}
            <button
              type="submit"
              className="btn btn-primary"
              style={{ width: '100%', justifyContent: 'center' }}
              disabled={loading || !username.trim() || !password}
            >
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>

        <p style={s.footer}>Albatha IT — Information Security Team</p>
      </div>
    </div>
  )
}

const s = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--bg-primary)',
    padding: '24px 16px',
  },
  container: {
    width: '100%',
    maxWidth: 400,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 20,
  },
  wordmark: {
    fontSize: 'var(--text-xl)',
    fontWeight: 600,
    color: 'var(--accent)',
    letterSpacing: '-0.02em',
  },
  subtitle: { fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: -12 },
  card: { width: '100%', padding: 0, overflow: 'hidden' },
  cardHeader: { padding: '24px 28px 0' },
  title: { fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--text-primary)' },
  desc: { fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: 6, lineHeight: 1.5 },
  form: { padding: '20px 28px 24px', display: 'flex', flexDirection: 'column', gap: 14 },
  field: { display: 'flex', flexDirection: 'column', gap: 5 },
  label: { fontSize: 'var(--text-sm)', fontWeight: 500, color: 'var(--text-secondary)' },
  error: {
    fontSize: 'var(--text-sm)',
    color: 'var(--risk-high)',
    background: 'var(--risk-high-bg)',
    border: '1px solid var(--risk-high)',
    borderRadius: 'var(--radius-sm)',
    padding: '8px 12px',
  },
  footer: { fontSize: 'var(--text-xs)', color: 'var(--text-muted)' },
}
